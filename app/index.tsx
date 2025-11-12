import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  LogBox,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const WS_SERVER_URL = 'ws://16.171.19.66:8000/ws/predict';

interface Prediction {
  type: 'prediction';
  predicted_class: string;
  confidence: number;
  timestamp: string;
}

interface SystemMessage {
  type: 'system';
  message: string;
  timestamp: string;
}

type ChatMessage = Prediction | SystemMessage;

export default function DentalAIScreen() {
  const [facing, setFacing] = useState<CameraType>('front');
  const [permission, requestPermission] = useCameraPermissions();
  const [analysisActive, setAnalysisActive] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [currentPrediction, setCurrentPrediction] = useState<Prediction | null>(null);
  const [status, setStatus] = useState('🔄 Initializing...');
  const [isConnected, setIsConnected] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  const [streamFPS, setStreamFPS] = useState(5); // Start with lower FPS

  const cameraRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef(0);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorAlertShownRef = useRef(false);
  const confidenceAnim = useRef(new Animated.Value(0)).current;
  const isStreamingRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    connectWebSocket();
    
    return () => {
      isMountedRef.current = false;
      disconnectWebSocket();
    };
  }, []);

  useEffect(() => {
    if (!currentPrediction) return;

    if (reduceMotionEnabled) {
      confidenceAnim.setValue(currentPrediction.confidence);
      return;
    }

    Animated.timing(confidenceAnim, {
      toValue: currentPrediction.confidence,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [currentPrediction, reduceMotionEnabled]);

  useEffect(() => {
    LogBox.ignoreLogs([
      '[Reanimated] Reduced motion setting is enabled on this device. This warning is visible only in the development mode. Some animations will be disabled by default.',
    ]);

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      setReduceMotionEnabled(Boolean(enabled));
    });

    const sub: any = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
      setReduceMotionEnabled(Boolean(enabled));
    });

    return () => {
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket(WS_SERVER_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setStatus('✅ Connected to AI Server');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        setStatus('⚠️ Disconnected - Tap to retry');
        setAnalysisActive(false);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('❌ Connection failed');
      };
    } catch (error) {
      console.error('WebSocket connection error:', error);
      Alert.alert('Connection Error', 'Failed to connect to AI server');
    }
  };

  const handleWebSocketMessage = (data: any) => {
    const msgType = (data.type || data.action || data.msg_type || '').toString().toLowerCase();

    switch (msgType) {
      case 'prediction':
        const prediction: Prediction = {
          type: 'prediction',
          predicted_class: data.predicted_class,
          confidence: data.confidence,
          timestamp: new Date().toLocaleTimeString(),
        };
        
        setCurrentPrediction(prediction);
        setChatHistory(prev => [...prev.slice(-11), prediction]);
        setTotalPredictions(prev => prev + 1);
        break;

      case 'status':
        const systemMessage: SystemMessage = {
          type: 'system',
          message: data.message,
          timestamp: new Date().toLocaleTimeString(),
        };
        setChatHistory(prev => [...prev.slice(-11), systemMessage]);
        break;

      case 'ack':
        if (data.frame_count) {
          // Handle acknowledgement
        }
        break;

      case 'error':
        setStatus('❌ ' + (data.message || 'Analysis error'));
        const errMsg: SystemMessage = {
          type: 'system',
          message: data.message || 'Analysis error',
          timestamp: new Date().toLocaleTimeString(),
        };
        setChatHistory(prev => [...prev.slice(-11), errMsg]);
        if (!(errorAlertShownRef.current)) {
          errorAlertShownRef.current = true;
        }
        break;

      default:
        console.debug('Unhandled WS message type:', msgType, data);
    }
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopVideoStream();
  };

  const startVideoStream = () => {
    if (!cameraRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    isStreamingRef.current = true;
    frameCountRef.current = 0;
    lastFrameTimeRef.current = 0;

    const frameInterval = 100 / streamFPS;

    const captureFrame = async () => {
      // Check if component is still mounted and streaming is active
      if (!isMountedRef.current || !isStreamingRef.current || !cameraRef.current) {
        return;
      }

      const now = Date.now();
      
      // Skip frame if too soon
      if (now - lastFrameTimeRef.current < frameInterval) {
        return;
      }

      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.4,
          base64: true,
          skipProcessing: true,
          exif: false,
        });

        if (photo?.base64 && wsRef.current?.readyState === WebSocket.OPEN) {
          frameCountRef.current++;
          lastFrameTimeRef.current = now;
          
          wsRef.current.send(JSON.stringify({
            type: 'video_frame',
            frame: photo.base64,
            frame_number: frameCountRef.current,
            timestamp: now,
            width: photo.width,
            height: photo.height,
          }));

          // Update status with frame count occasionally
          if (frameCountRef.current % 15 === 0) {
            setStatus(`🎥 Streaming (${streamFPS} FPS) - ${frameCountRef.current} frames`);
          }

          // Send ack every 10 frames
          if (frameCountRef.current % 10 === 0) {
            wsRef.current.send(JSON.stringify({
              action: 'ack',
              frame_count: frameCountRef.current,
              fps: streamFPS,
            }));
          }
        }
      } catch (error: any) {
        // Only log errors that aren't "camera unmounted" during shutdown
        if (isMountedRef.current && isStreamingRef.current) {
          console.log('Frame capture skipped:', error.message);
        }
      }
    };

    // Clear any existing interval
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
    }

    // Start new interval - use slightly faster interval for better timing
    captureIntervalRef.current = setInterval(captureFrame, frameInterval / 2);
  };

  const stopVideoStream = () => {
    isStreamingRef.current = false;
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    lastFrameTimeRef.current = 0;
  };

  const startAnalysis = () => {
    if (!isConnected) {
      connectWebSocket();
      setTimeout(startAnalysis, 1000);
      return;
    }

    setAnalysisActive(true);
    setStatus(`🎥 Starting Video Stream (${streamFPS} FPS)...`);
    setCurrentPrediction(null);

    // Small delay to ensure state is updated
    setTimeout(() => {
      startVideoStream();
    }, 100);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'start_video_stream',
        target_fps: streamFPS,
        predict_every_frames: 1,
      }));
    }
  };

  const stopAnalysis = () => {
    setAnalysisActive(false);
    setStatus('⏸️ Ready for Analysis');
    setCurrentPrediction(null);

    stopVideoStream();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'stop_video_stream' }));
    }
  };

  const toggleStreamFPS = () => {
    const fpsOptions = [3, 5, 8, 10]; // More conservative FPS options
    const currentIndex = fpsOptions.indexOf(streamFPS);
    const nextIndex = (currentIndex + 1) % fpsOptions.length;
    const newFPS = fpsOptions[nextIndex];
    
    setStreamFPS(newFPS);
    
    if (analysisActive) {
      setStatus(`🔄 Switching to ${newFPS} FPS...`);
      stopVideoStream();
      setTimeout(() => {
        startVideoStream();
        setStatus(`🎥 Streaming Video (${newFPS} FPS)...`);
      }, 200);
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const clearHistory = () => {
    setChatHistory([]);
    setTotalPredictions(0);
    setCurrentPrediction(null);
  };

  const formatClassName = (className: string) => {
    return className
      .replace(/_/g, ' ')
      .replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to use the camera</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const confidenceWidth = confidenceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dental Flow - Video Stream</Text>
        <Text style={styles.subtitle}>Live {streamFPS} FPS Video Analysis</Text>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            facing={facing}
            ref={cameraRef}
          />
          
          {currentPrediction && (
            <View style={styles.predictionOverlay}>
              <Text style={styles.overlayTitle}>Live Diagnosis</Text>
              <Text style={styles.predictionText}>
                {formatClassName(currentPrediction.predicted_class)}
              </Text>
              <Text style={styles.confidenceText}>
                Confidence: {(currentPrediction.confidence * 100).toFixed(1)}%
              </Text>
              <View style={styles.confidenceBar}>
                <Animated.View 
                  style={[
                    styles.confidenceFill,
                    { width: confidenceWidth }
                  ]} 
                />
              </View>
              <Text style={styles.fpsText}>
                📹 {streamFPS} FPS • 🖼️ {frameCountRef.current} frames
              </Text>
            </View>
          )}

          <View style={styles.cameraControls}>
            <TouchableOpacity style={styles.flipButton} onPress={toggleCameraFacing}>
              <Text style={styles.flipButtonText}>🔄 Flip</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.fpsButton} onPress={toggleStreamFPS}>
              <Text style={styles.fpsButtonText}>🎥 {streamFPS} FPS</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.controlsContainer}>
          <View style={[styles.statusBadge, analysisActive ? styles.statusActive : styles.statusInactive]}>
            <Text style={styles.statusText}>
              {status}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.startButton,
                analysisActive && styles.buttonDisabled
              ]}
              onPress={startAnalysis}
              disabled={analysisActive}
            >
              <Text style={styles.controlButtonText}>🎥 Start Video Stream</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.controlButton,
                styles.stopButton,
                !analysisActive && styles.buttonDisabled
              ]}
              onPress={stopAnalysis}
              disabled={!analysisActive}
            >
              <Text style={styles.controlButtonText}>⏹ Stop Stream</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>📊 Live Video Stats</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {currentPrediction ? formatClassName(currentPrediction.predicted_class) : '--'}
              </Text>
              <Text style={styles.statLabel}>Current</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{streamFPS}</Text>
              <Text style={styles.statLabel}>FPS</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{frameCountRef.current}</Text>
              <Text style={styles.statLabel}>Frames</Text>
            </View>
          </View>
        </View>

        <View style={styles.chatContainer}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle}>📋 Diagnosis History</Text>
            <TouchableOpacity onPress={clearHistory}>
              <Text style={styles.clearButton}>🗑️ Clear</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.chatHistory} nestedScrollEnabled>
            {chatHistory.length === 0 ? (
              <View style={[styles.chatMessage, styles.systemMessage]}>
                <Text style={styles.systemMessageText}>
                  🎯 Start analysis to see real-time predictions here
                </Text>
              </View>
            ) : (
              chatHistory.map((message, index) => (
                <View
                  key={index}
                  style={[
                    styles.chatMessage,
                    message.type === 'prediction' ? styles.predictionMessage : styles.systemMessage,
                  ]}
                >
                  {message.type === 'prediction' ? (
                    <>
                      <View style={styles.messageHeader}>
                        <Text style={styles.messageTitle}>
                          🦷 {formatClassName(message.predicted_class)}
                        </Text>
                        <Text style={styles.messageTime}>{message.timestamp}</Text>
                      </View>
                      <View style={styles.confidenceBar}>
                        <View 
                          style={[
                            styles.confidenceFill,
                            { width: `${message.confidence * 100}%` }
                          ]} 
                        />
                      </View>
                      <Text style={styles.confidenceLabel}>
                        Confidence: {(message.confidence * 100).toFixed(1)}%
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.systemMessageText}>{message.message}</Text>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>

        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>💡 Tips for Best Results</Text>
          <Text style={styles.infoText}>
            • Ensure good lighting{"\n"}
            • Focus on specific areas{"\n"}
            • Keep camera steady{"\n"}
            • Lower FPS for better stability{"\n"}
            • Start/stop as needed
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1bd4daff',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: 'rgba(102, 126, 234, 1)',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginTop: 4,
  },
  message: {
    textAlign: 'center',
    fontSize: 16,
    marginBottom: 16,
  },
  cameraContainer: {
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    width: '100%',
    aspectRatio: 4/6,
  },
  predictionOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(102, 126, 234, 0.95)',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  overlayTitle: {
    color: 'white',
    fontSize: 14,
    opacity: 0.9,
  },
  predictionText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
  },
  confidenceText: {
    color: 'white',
    fontSize: 14,
    opacity: 0.9,
    marginBottom: 8,
  },
  confidenceBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 3,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  flipButton: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  flipButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 12,
  },
  fpsButton: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  fpsButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 12,
  },
  fpsText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 4,
  },
  controlsContainer: {
    margin: 16,
  },
  statusBadge: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    marginBottom: 16,
    alignItems: 'center',
  },
  statusActive: {
    backgroundColor: '#28a745',
  },
  statusInactive: {
    backgroundColor: '#6c757d',
  },
  statusText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 25,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#28a745',
  },
  stopButton: {
    backgroundColor: '#dc3545',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  controlButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  statsCard: {
    backgroundColor: 'rgba(240, 147, 251, 1)',
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  statsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },
  chatContainer: {
    margin: 16,
    backgroundColor: '#16a855',
    borderRadius: 16,
    padding: 16,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  chatTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  clearButton: {
    color: '#dc3545',
    fontWeight: '600',
  },
  chatHistory: {
    maxHeight: 300,
  },
  chatMessage: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  predictionMessage: {
    backgroundColor: 'rgba(102, 126, 234, 1)',
  },
  systemMessage: {
    backgroundColor: '#a9b4c0',
    borderColor: '#e9ecef',
    borderWidth: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  messageTitle: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    flex: 1,
  },
  messageTime: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
  confidenceLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    marginTop: 4,
  },
  systemMessageText: {
    color: '#6c757d',
    textAlign: 'center',
    fontSize: 14,
  },
  infoContainer: {
    margin: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#4f2828',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignSelf: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
});