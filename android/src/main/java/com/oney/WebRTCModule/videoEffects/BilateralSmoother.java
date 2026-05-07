package com.oney.WebRTCModule.videoEffects;

import android.opengl.GLES20;
import android.opengl.GLES30;
import android.util.Log;

import com.oney.WebRTCModule.EglUtils;

import org.webrtc.EglBase;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * OpenGL ES 2.0 bilateral smoother for a single-channel luminance plane.
 *
 * Separable 9-tap bilateral: one fragment shader runs horizontally, then
 * vertically, with the output of the first pass feeding the second. Source
 * Y plane is uploaded as a GL_LUMINANCE texture; intermediate and final
 * targets are GL_RGBA (GL_LUMINANCE is not a guaranteed FBO color format
 * in GLES 2.0). The R channel of the final target is read back into the
 * caller-provided dst buffer.
 *
 * Thread model: all public methods must be called on the same thread,
 * which is the video-processor callback thread. The EGL context is created
 * lazily on first {@link #smoothYPlane} call and made current; it is not
 * released between frames.
 */
public class BilateralSmoother {
    private static final String TAG = "BilateralSmoother";

    // Fixed 9-tap (radius=4) separable kernel. Hardcoded in shader.
    private static final String VERTEX_SHADER_SOURCE =
            "attribute vec2 aPosition;\n" +
            "attribute vec2 aTexCoord;\n" +
            "varying   vec2 vTexCoord;\n" +
            "void main() {\n" +
            "    vTexCoord = aTexCoord;\n" +
            "    gl_Position = vec4(aPosition, 0.0, 1.0);\n" +
            "}\n";

    private static final String FRAGMENT_SHADER_SOURCE =
            "precision mediump float;\n" +
            "uniform sampler2D uTex;\n" +
            "uniform vec2 uDirection;\n" +      // (1,0) horizontal, (0,1) vertical
            "uniform vec2 uTexelSize;\n" +      // (1/width, 1/height)
            "uniform float uDistanceNorm;\n" +  // 2.5 – 8.0
            "uniform float uTexelSpacing;\n" +  // 1.0 – 4.0
            "varying vec2 vTexCoord;\n" +
            "void main() {\n" +
            "    float center = texture2D(uTex, vTexCoord).r;\n" +
            "    float rangeSigma = 1.0 / max(uDistanceNorm, 0.001);\n" +
            "    float rangeDenom = 2.0 * rangeSigma * rangeSigma;\n" +
            "    const float spatialDenom = 2.0 * 4.0 * 4.0;\n" +
            "    float totalWeight = 0.0;\n" +
            "    float totalLuma = 0.0;\n" +
            "    for (int i = -4; i <= 4; i++) {\n" +
            "        float fi = float(i);\n" +
            "        vec2 offset = uDirection * fi * uTexelSpacing * uTexelSize;\n" +
            "        float sampleLuma = texture2D(uTex, vTexCoord + offset).r;\n" +
            "        float spatialWeight = exp(-(fi * fi) / spatialDenom);\n" +
            "        float rangeDiff = sampleLuma - center;\n" +
            "        float rangeWeight = exp(-(rangeDiff * rangeDiff) / rangeDenom);\n" +
            "        float w = spatialWeight * rangeWeight;\n" +
            "        totalWeight += w;\n" +
            "        totalLuma += sampleLuma * w;\n" +
            "    }\n" +
            "    float result = totalLuma / max(totalWeight, 0.0001);\n" +
            "    gl_FragColor = vec4(result, 0.0, 0.0, 1.0);\n" +
            "}\n";

    // Full-screen quad. Pos xy + texCoord uv, interleaved.
    private static final float[] QUAD_VERTICES = {
        //  pos x,  pos y,  u,   v
            -1.0f, -1.0f,   0.0f, 0.0f,
             1.0f, -1.0f,   1.0f, 0.0f,
            -1.0f,  1.0f,   0.0f, 1.0f,
             1.0f,  1.0f,   1.0f, 1.0f,
    };

    // Config
    private volatile boolean enabled = false;
    private volatile float distanceNorm = 8.0f;
    private volatile float texelSpacing = 1.0f;

    // GL state — only touched on the processor thread
    private EglBase eglBase;
    private int program = 0;
    private int aPosition, aTexCoord;
    private int uTex, uDirection, uTexelSize, uDistanceNorm, uTexelSpacing;
    private FloatBuffer quadVertexBuffer;

    private int srcTexture = 0;              // GL_LUMINANCE, source Y plane
    private int passATexture = 0;            // GL_RGBA, horizontal-pass output
    private int passBTexture = 0;            // GL_RGBA, vertical-pass output
    private int fboA = 0;
    private int fboB = 0;
    private int allocatedWidth = 0;
    private int allocatedHeight = 0;

    private boolean setupAttempted = false;
    private boolean setupSucceeded = false;

    // Texture format selection — chosen at init based on ES version.
    // ES 3.0+: GL_R8 / GL_RED for both source and ping-pong targets (1 byte
    //          per pixel, FBO-renderable in ES 3.0, 1-byte readback).
    // ES 2.0:  source is GL_LUMINANCE; ping-pong targets are GL_RGBA (required
    //          for FBO color-completeness in GLES 2.0). Readback extracts the
    //          R channel from GL_RGBA pixels.
    private int yTexInternalFormat  = GLES20.GL_LUMINANCE;
    private int yTexFormat          = GLES20.GL_LUMINANCE;
    private int pingPongInternalFmt = GLES20.GL_RGBA;
    private int pingPongFormat      = GLES20.GL_RGBA;
    private int readbackFormat      = GLES20.GL_RGBA;
    private int readbackBytesPerPx  = 4;
    private boolean useR8           = false;

    // Reused CPU-side readback buffer. Size depends on readback format.
    private ByteBuffer readbackBuffer;
    // Reused upload buffer used when the source ByteBuffer has stride != width
    private ByteBuffer packedUploadBuffer;

    public void updateConfig(boolean enabled, float distanceNorm, float texelSpacing) {
        this.enabled = enabled;
        this.distanceNorm = distanceNorm;
        this.texelSpacing = texelSpacing;
    }

    public boolean isEnabled() {
        return enabled && setupSucceeded;
    }

    /**
     * Smooth a Y plane from {@code srcY} (with {@code srcStride} bytes per row)
     * into {@code dstY} (tightly packed at {@code width} bytes per row).
     *
     * Buffers must be direct (native-order) for JNI zero-copy.
     *
     * @return true if smoothing ran and dstY was populated; false on failure
     *         (caller should copy the source Y through to dstY instead).
     */
    public boolean smoothYPlane(ByteBuffer srcY, int srcStride, ByteBuffer dstY,
                                int width, int height) {
        if (!enabled) {
            return false;
        }
        if (width <= 0 || height <= 0 || srcY == null || dstY == null) {
            return false;
        }
        if (!ensureSetup()) {
            return false;
        }
        if (!ensureSize(width, height)) {
            return false;
        }

        try {
            eglBase.makeCurrent();

            uploadYPlane(srcY, srcStride, width, height);
            runPass(srcTexture, fboA, 1.0f, 0.0f, width, height);
            runPass(passATexture, fboB, 0.0f, 1.0f, width, height);
            readY(dstY, width, height);

            return true;
        } catch (RuntimeException e) {
            Log.e(TAG, "smoothYPlane failed: " + e.getMessage(), e);
            return false;
        }
    }

    public synchronized void release() {
        if (!setupSucceeded) {
            return;
        }
        try {
            eglBase.makeCurrent();
            if (program != 0) {
                GLES20.glDeleteProgram(program);
                program = 0;
            }
            deleteTextures();
            deleteFbos();
        } catch (RuntimeException ignored) {
            // best-effort cleanup
        } finally {
            if (eglBase != null) {
                eglBase.release();
                eglBase = null;
            }
            setupSucceeded = false;
            setupAttempted = false;
        }
    }

    // --- Lazy GL setup ---

    private boolean ensureSetup() {
        if (setupAttempted) {
            return setupSucceeded;
        }
        setupAttempted = true;

        EglBase.Context rootContext = EglUtils.getRootEglBaseContext();
        try {
            // Share the WebRTC root context so we use the same driver/config.
            if (rootContext != null) {
                eglBase = EglBase.create(rootContext, EglBase.CONFIG_PIXEL_BUFFER);
            } else {
                eglBase = EglBase.create(null, EglBase.CONFIG_PIXEL_BUFFER);
            }
            eglBase.createDummyPbufferSurface();
            eglBase.makeCurrent();
        } catch (RuntimeException e) {
            Log.e(TAG, "Failed to create EglBase: " + e.getMessage(), e);
            eglBase = null;
            return false;
        }

        // Detect ES 3.0+ so we can avoid the deprecated GL_LUMINANCE path.
        String versionStr = GLES20.glGetString(GLES20.GL_VERSION);
        useR8 = versionStr != null && versionStr.contains("OpenGL ES 3");
        if (useR8) {
            yTexInternalFormat  = GLES30.GL_R8;
            yTexFormat          = GLES30.GL_RED;
            pingPongInternalFmt = GLES30.GL_R8;
            pingPongFormat      = GLES30.GL_RED;
            readbackFormat      = GLES30.GL_RED;
            readbackBytesPerPx  = 1;
        } else {
            yTexInternalFormat  = GLES20.GL_LUMINANCE;
            yTexFormat          = GLES20.GL_LUMINANCE;
            pingPongInternalFmt = GLES20.GL_RGBA;
            pingPongFormat      = GLES20.GL_RGBA;
            readbackFormat      = GLES20.GL_RGBA;
            readbackBytesPerPx  = 4;
        }

        program = buildProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
        if (program == 0) {
            return false;
        }

        aPosition      = GLES20.glGetAttribLocation(program,  "aPosition");
        aTexCoord      = GLES20.glGetAttribLocation(program,  "aTexCoord");
        uTex           = GLES20.glGetUniformLocation(program, "uTex");
        uDirection     = GLES20.glGetUniformLocation(program, "uDirection");
        uTexelSize     = GLES20.glGetUniformLocation(program, "uTexelSize");
        uDistanceNorm  = GLES20.glGetUniformLocation(program, "uDistanceNorm");
        uTexelSpacing  = GLES20.glGetUniformLocation(program, "uTexelSpacing");

        ByteBuffer bb = ByteBuffer.allocateDirect(QUAD_VERTICES.length * 4);
        bb.order(ByteOrder.nativeOrder());
        quadVertexBuffer = bb.asFloatBuffer();
        quadVertexBuffer.put(QUAD_VERTICES);
        quadVertexBuffer.position(0);

        setupSucceeded = true;
        return true;
    }

    private boolean ensureSize(int width, int height) {
        if (srcTexture != 0 && passATexture != 0 && passBTexture != 0
                && allocatedWidth == width && allocatedHeight == height) {
            return true;
        }
        deleteTextures();
        deleteFbos();

        int[] ids = new int[3];
        GLES20.glGenTextures(3, ids, 0);
        srcTexture   = ids[0];
        passATexture = ids[1];
        passBTexture = ids[2];

        // Source: single-channel (GL_R8 on ES 3.0+, GL_LUMINANCE on ES 2.0).
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, srcTexture);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S,     GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T,     GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, yTexInternalFormat,
                            width, height, 0,
                            yTexFormat, GLES20.GL_UNSIGNED_BYTE, null);

        // Ping-pong targets: R8 on ES 3.0+, RGBA8 on ES 2.0 (FBO color-complete).
        for (int tex : new int[] { passATexture, passBTexture }) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S,     GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T,     GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, pingPongInternalFmt,
                                width, height, 0,
                                pingPongFormat, GLES20.GL_UNSIGNED_BYTE, null);
        }

        int[] fbos = new int[2];
        GLES20.glGenFramebuffers(2, fbos, 0);
        fboA = fbos[0];
        fboB = fbos[1];

        if (!attachFbo(fboA, passATexture)) return fail("passA FBO incomplete");
        if (!attachFbo(fboB, passBTexture)) return fail("passB FBO incomplete");

        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0);

        allocatedWidth  = width;
        allocatedHeight = height;

        int readbackSize = width * height * readbackBytesPerPx;
        if (readbackBuffer == null || readbackBuffer.capacity() < readbackSize) {
            readbackBuffer = ByteBuffer.allocateDirect(readbackSize).order(ByteOrder.nativeOrder());
        }

        int uploadSize = width * height;
        if (packedUploadBuffer == null || packedUploadBuffer.capacity() < uploadSize) {
            packedUploadBuffer = ByteBuffer.allocateDirect(uploadSize).order(ByteOrder.nativeOrder());
        }

        return true;
    }

    private boolean fail(String msg) {
        Log.e(TAG, msg);
        deleteTextures();
        deleteFbos();
        return false;
    }

    private boolean attachFbo(int fbo, int tex) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo);
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER,
                                      GLES20.GL_COLOR_ATTACHMENT0,
                                      GLES20.GL_TEXTURE_2D, tex, 0);
        int status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER);
        return status == GLES20.GL_FRAMEBUFFER_COMPLETE;
    }

    private void deleteTextures() {
        int[] ids = { srcTexture, passATexture, passBTexture };
        int count = 0;
        for (int id : ids) if (id != 0) count++;
        if (count > 0) {
            int[] toDelete = new int[count];
            int idx = 0;
            for (int id : ids) if (id != 0) toDelete[idx++] = id;
            GLES20.glDeleteTextures(count, toDelete, 0);
        }
        srcTexture = passATexture = passBTexture = 0;
        allocatedWidth = allocatedHeight = 0;
    }

    private void deleteFbos() {
        int[] ids = { fboA, fboB };
        int count = 0;
        for (int id : ids) if (id != 0) count++;
        if (count > 0) {
            int[] toDelete = new int[count];
            int idx = 0;
            for (int id : ids) if (id != 0) toDelete[idx++] = id;
            GLES20.glDeleteFramebuffers(count, toDelete, 0);
        }
        fboA = fboB = 0;
    }

    // --- Per-frame operations ---

    private void uploadYPlane(ByteBuffer srcY, int srcStride, int width, int height) {
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, srcTexture);

        ByteBuffer uploadBuffer;
        if (srcStride == width && srcY.isDirect()) {
            srcY.position(0);
            uploadBuffer = srcY;
        } else {
            packedUploadBuffer.position(0);
            for (int row = 0; row < height; row++) {
                int srcOffset = row * srcStride;
                for (int col = 0; col < width; col++) {
                    packedUploadBuffer.put(srcY.get(srcOffset + col));
                }
            }
            packedUploadBuffer.position(0);
            uploadBuffer = packedUploadBuffer;
        }

        // glTexSubImage2D is faster than re-allocating via glTexImage2D.
        GLES20.glTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, width, height,
                               yTexFormat, GLES20.GL_UNSIGNED_BYTE, uploadBuffer);
    }

    private void runPass(int inputTexture, int targetFbo, float dirX, float dirY,
                         int width, int height) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, targetFbo);
        GLES20.glViewport(0, 0, width, height);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);

        GLES20.glUseProgram(program);

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, inputTexture);
        GLES20.glUniform1i(uTex, 0);

        GLES20.glUniform2f(uDirection,    dirX, dirY);
        GLES20.glUniform2f(uTexelSize,    1.0f / width, 1.0f / height);
        GLES20.glUniform1f(uDistanceNorm, distanceNorm);
        GLES20.glUniform1f(uTexelSpacing, texelSpacing);

        // Interleaved position (offset 0) + texCoord (offset 2 floats)
        quadVertexBuffer.position(0);
        GLES20.glEnableVertexAttribArray(aPosition);
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 4 * 4, quadVertexBuffer);

        quadVertexBuffer.position(2);
        GLES20.glEnableVertexAttribArray(aTexCoord);
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 4 * 4, quadVertexBuffer);

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);

        GLES20.glDisableVertexAttribArray(aPosition);
        GLES20.glDisableVertexAttribArray(aTexCoord);
    }

    private void readY(ByteBuffer dstY, int width, int height) {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fboB);
        readbackBuffer.position(0);
        GLES20.glReadPixels(0, 0, width, height,
                            readbackFormat, GLES20.GL_UNSIGNED_BYTE, readbackBuffer);

        int pixels = width * height;
        dstY.position(0);
        readbackBuffer.position(0);

        if (readbackBytesPerPx == 1) {
            // ES 3.0 path — tightly packed bytes, copy straight across.
            for (int p = 0; p < pixels; p++) {
                dstY.put(readbackBuffer.get(p));
            }
        } else {
            // ES 2.0 path — RGBA: extract R channel (smoothed Y).
            for (int p = 0; p < pixels; p++) {
                dstY.put(readbackBuffer.get(p * 4));
            }
        }
        dstY.position(0);

        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    }

    // --- Shader compilation ---

    private static int buildProgram(String vertSrc, String fragSrc) {
        int vert = compileShader(GLES20.GL_VERTEX_SHADER,   vertSrc);
        if (vert == 0) return 0;
        int frag = compileShader(GLES20.GL_FRAGMENT_SHADER, fragSrc);
        if (frag == 0) {
            GLES20.glDeleteShader(vert);
            return 0;
        }

        int prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, vert);
        GLES20.glAttachShader(prog, frag);
        GLES20.glLinkProgram(prog);

        int[] linkStatus = new int[1];
        GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, linkStatus, 0);
        if (linkStatus[0] != GLES20.GL_TRUE) {
            Log.e(TAG, "Program link failed: " + GLES20.glGetProgramInfoLog(prog));
            GLES20.glDeleteProgram(prog);
            prog = 0;
        }

        GLES20.glDeleteShader(vert);
        GLES20.glDeleteShader(frag);
        return prog;
    }

    private static int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);

        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] != GLES20.GL_TRUE) {
            Log.e(TAG, "Shader compile failed: " + GLES20.glGetShaderInfoLog(shader));
            GLES20.glDeleteShader(shader);
            return 0;
        }
        return shader;
    }
}
