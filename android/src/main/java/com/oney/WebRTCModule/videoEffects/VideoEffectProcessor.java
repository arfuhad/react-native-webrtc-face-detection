package com.oney.WebRTCModule.videoEffects;

import android.util.Log;

import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;
import org.webrtc.VideoProcessor;
import org.webrtc.VideoSink;

import java.util.List;

/**
 * Lightweight abstraction for an object that can receive video frames, process and add effects in
 * them, and pass them on to another object.
 */
public class VideoEffectProcessor implements VideoProcessor {
    private VideoSink mSink;
    final private SurfaceTextureHelper textureHelper;
    final private List<VideoFrameProcessor> videoFrameProcessors;

    public VideoEffectProcessor(List<VideoFrameProcessor> processors, SurfaceTextureHelper textureHelper) {
        this.textureHelper = textureHelper;
        this.videoFrameProcessors = processors;
    }

    @Override
    public void onCapturerStarted(boolean success) {}

    @Override
    public void onCapturerStopped() {}

    @Override
    public void setSink(VideoSink sink) {
        mSink = sink;
    }

    // #region agent log helper
    private void debugLog(String hypothesisId, String message, String data) {
        Log.d("DEBUG_AGENT", "[" + hypothesisId + "] VEP:" + message + " " + data);
    }
    // #endregion

    /**
     * Called just after the frame is captured.
     * Will process the VideoFrame with the help of VideoFrameProcessor and send the processed
     * VideoFrame back to webrtc using onFrame method in VideoSink.
     * @param frame raw VideoFrame received from webrtc.
     */
    @Override
    public void onFrameCaptured(VideoFrame frame) {
        // #region agent log
        debugLog("B", "onFrameCaptured_entry", "{\"processorCount\":" + videoFrameProcessors.size() + "}");
        // #endregion
        
        frame.retain();
        VideoFrame outputFrame = frame;
        for (VideoFrameProcessor processor : this.videoFrameProcessors) {
            VideoFrame previousFrame = outputFrame;
            outputFrame = processor.process(outputFrame, textureHelper);

            if (outputFrame == null) {
                mSink.onFrame(frame);
                frame.release();
                return;
            }
            
            // If processor returned a different frame, release the previous one
            if (outputFrame != previousFrame && previousFrame != frame) {
                previousFrame.release();
            }
        }

        // #region agent log
        boolean sameFrame = (outputFrame == frame);
        debugLog("B", "before_sink_release", "{\"sameFrame\":" + sameFrame + "}");
        // #endregion

        // Check if sink is valid before passing frame
        if (mSink != null) {
            mSink.onFrame(outputFrame);
        }
        
        // Only release outputFrame if it's different from the original frame
        // to avoid double-releasing when processors return the same frame
        if (outputFrame != frame) {
            // #region agent log
            debugLog("B", "releasing_different_outputFrame", "{}");
            // #endregion
            outputFrame.release();
        }
        frame.release();
        
        // #region agent log
        debugLog("B", "onFrameCaptured_exit", "{}");
        // #endregion
    }
}
