require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name                = package['name']
  s.version             = package['version']
  s.summary             = package['description']
  s.homepage            = 'https://github.com/arfuhad/react-native-webrtc-face-detection'
  s.license             = package['license']
  s.author              = 'arfuhad'
  s.source              = { :git => 'git@github.com:arfuhad/react-native-webrtc-face-detection.git', :tag => 'release #{s.version}' }
  s.requires_arc        = true

  s.platforms           = { :ios => '15.5', :osx => '10.13', :tvos => '16.0' }

  s.preserve_paths      = 'ios/**/*'
  s.source_files        = 'ios/**/*.{h,m,metal}'
  s.libraries           = 'c', 'sqlite3', 'stdc++'
  s.framework           = 'AudioToolbox','AVFoundation', 'CoreAudio', 'CoreGraphics', 'CoreVideo', 'GLKit', 'Metal', 'MetalKit', 'VideoToolbox'
  s.dependency          'React-Core'
  s.dependency          'JitsiWebRTC', '~> 124.0.0'
  s.dependency          'GoogleMLKit/FaceDetection', '~> 8.0.0'
end

