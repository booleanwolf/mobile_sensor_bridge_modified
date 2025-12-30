/**
 * IMU Sensor Manager
 * Handles device motion data from the device's inertial measurement unit (IMU)
 * Supports both iOS and Android devices
 * Collects accelerometer, gyroscope, and magnetometer data
 */

class IMUSensorManager {
  constructor() {
    this.isActive = false;
    this.ws = null;
    this.sampleRate = 30; // Hz - default value, will be updated from config
    this.intervalId = null;
    
    // Store sensor data - accelerometer, gyroscope, and magnetometer
    this.accelerometerData = { x: 0, y: 0, z: 0 };
    this.gyroscopeData = { alpha: 0, beta: 0, gamma: 0 };
    this.magnetometerData = { x: 0, y: 0, z: 0, heading: 0 };
    
    // Device detection
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    
    // Device motion permission status
    this.permissionGranted = false;
    this.orientationPermissionGranted = false;
    
    // Load configuration
    this.loadConfig();
  }

  /**
   * Load IMU configuration from server
   */
  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        if (config.imu && config.imu.sample_rate) {
          this.sampleRate = config.imu.sample_rate;
          console.log('IMU sample rate loaded from config:', this.sampleRate, 'Hz');
        }
      }
    } catch (error) {
      console.warn('Failed to load IMU config, using default sample rate:', this.sampleRate);
    }
  }

  /**
   * Request permission to access device motion and orientation data
   * Required for iOS 13+ and modern Android browsers due to privacy restrictions
   * @returns {Promise} - Resolves when permission is granted, rejects when denied
   */
  async requestPermission() {
    // For Android devices - check if permission is needed
    if (this.isAndroid) {
      console.log('Android device detected, checking if permission is needed...');
      
      // Check if DeviceMotionEvent requires permission (modern Android browsers)
      const hasMotionAPI = typeof DeviceMotionEvent !== 'undefined' && 
                           typeof DeviceMotionEvent.requestPermission === 'function';
      
      const hasOrientationAPI = typeof DeviceOrientationEvent !== 'undefined' && 
                                typeof DeviceOrientationEvent.requestPermission === 'function';
      
      if (hasMotionAPI || hasOrientationAPI) {
        try {
          // Request motion permission
          if (hasMotionAPI) {
            console.log('Requesting DeviceMotionEvent permission for Android...');
            const motionState = await DeviceMotionEvent.requestPermission();
            console.log('Android motion permission state:', motionState);
            
            if (motionState === 'granted') {
              console.log('Android motion permission granted');
              this.permissionGranted = true;
            } else {
              console.warn('Android motion permission denied:', motionState);
              return false;
            }
          }
          
          // Request orientation permission for magnetometer
          if (hasOrientationAPI) {
            console.log('Requesting DeviceOrientationEvent permission for Android...');
            const orientationState = await DeviceOrientationEvent.requestPermission();
            console.log('Android orientation permission state:', orientationState);
            
            if (orientationState === 'granted') {
              console.log('Android orientation permission granted');
              this.orientationPermissionGranted = true;
            } else {
              console.warn('Android orientation permission denied:', orientationState);
            }
          }
          
          return this.permissionGranted;
        } catch (error) {
          console.error('Error requesting Android sensor permissions:', error);
          return false;
        }
      } else {
        console.log('Android device: no explicit permission API available, assuming granted');
        this.permissionGranted = true;
        this.orientationPermissionGranted = true;
        return Promise.resolve(true);
      }
    }
    
    // For non-iOS and non-Android devices
    if (!this.isIOS) {
      console.log('Not an iOS/Android device, no need to request permission');
      this.permissionGranted = true;
      this.orientationPermissionGranted = true;
      return Promise.resolve(true);
    }
    
    // iOS-specific permission handling
    // Check for DeviceMotionEvent and DeviceOrientationEvent APIs
    const hasMotionAPI = typeof DeviceMotionEvent !== 'undefined' && 
                         typeof DeviceMotionEvent.requestPermission === 'function';
    
    const hasOrientationAPI = typeof DeviceOrientationEvent !== 'undefined' && 
                              typeof DeviceOrientationEvent.requestPermission === 'function';
    
    // iOS 13+ requires explicit permission
    if (hasMotionAPI || hasOrientationAPI) {
      try {
        console.log('Requesting motion and orientation permissions for iOS device...');
        
        // Request permission for DeviceMotionEvent
        if (hasMotionAPI) {
          console.log('Requesting DeviceMotionEvent permission...');
          const motionState = await DeviceMotionEvent.requestPermission();
          console.log('Motion permission state:', motionState);
          
          if (motionState === 'granted') {
            console.log('Motion permission granted');
            this.permissionGranted = true;
          } else {
            console.warn('Motion permission denied:', motionState);
            return false;
          }
        }
        
        // Request permission for DeviceOrientationEvent (magnetometer)
        if (hasOrientationAPI) {
          console.log('Requesting DeviceOrientationEvent permission...');
          const orientationState = await DeviceOrientationEvent.requestPermission();
          console.log('Orientation permission state:', orientationState);
          
          if (orientationState === 'granted') {
            console.log('Orientation permission granted');
            this.orientationPermissionGranted = true;
          } else {
            console.warn('Orientation permission denied:', orientationState);
          }
        }
        
        return this.permissionGranted;
      } catch (error) {
        console.error('Error requesting sensor permissions:', error);
        console.error('Error details:', error.message);
        return false;
      }
    } else {
      // For non-iOS 13+ devices or desktop browsers
      console.log('Permission API not available, assuming granted');
      this.permissionGranted = true;
      this.orientationPermissionGranted = true;
      return true;
    }
  }

  // Start IMU data collection and transmission
  async startIMUSensor(websocket, isSessionActive) {
    this.ws = websocket;
    this.isActive = isSessionActive;
    
    if (!this.isIOS && !this.isAndroid) {
      console.log('IMU sensor only implemented for iOS and Android devices');
      return false;
    }
    
    try {
      // Check Android sensor availability first if on Android
      if (this.isAndroid) {
        const sensorsAvailable = this.checkAndroidSensorAvailability();
        if (!sensorsAvailable) {
          console.error('Required sensors not available on this Android device');
          if (typeof alert === 'function') {
            setTimeout(() => {
              alert('This device does not support the required motion sensors. Some features may not work correctly.');
            }, 500);
          }
          // We don't return false here as we can still try with whatever sensors are available
        }
      }
      
      // Request permission if needed
      console.log('Starting IMU sensor and requesting permissions...');
      const permissionGranted = await this.requestPermission();
      
      if (!permissionGranted) {
        console.error('IMU sensor permission denied');
        // Show a user-friendly alert
        if (typeof alert === 'function') {
          setTimeout(() => {
            alert('IMU sensor access was denied. Please enable motion access in your device settings to use this feature.');
          }, 500);
        }
        return false;
      }
      
      console.log('Permission granted, setting up sensors...');
      
      // Setup event handlers for accelerometer and gyroscope
      this.setupAccelerometerAndGyroscope();
      
      // Setup magnetometer listener
      this.setupMagnetometer();
      
      // Start sending data at the specified sample rate
      this.intervalId = setInterval(() => {
        this.sendSensorData();
      }, 1000 / this.sampleRate);
      
      const deviceType = this.isIOS ? 'iOS' : 'Android';
      console.log(`${deviceType} IMU sensor manager initialized successfully`);
      return true;
    } catch (error) {
      console.error('Error initializing IMU sensor:', error);
      return false;
    }
  }

  // Start IMU data collection and transmission without requesting permission (assumes already granted)
  async startIMUSensorWithoutPermission(websocket, isSessionActive) {
    try {
      this.ws = websocket;  // Use consistent property name
      this.websocket = websocket;  // Keep backup for compatibility
      this.isActive = isSessionActive;
      
      // Check if we already have permission (for iOS) or if we're on Android
      if (this.isIOS && !this.permissionGranted) {
        console.warn('Permission not granted for iOS IMU sensor, cannot start without permission');
        return false;
      }
      
      // For Android or when iOS permission is already granted, proceed directly
      console.log('Starting IMU sensor with existing permissions...');
      
      // Setup event handlers for accelerometer and gyroscope
      this.setupAccelerometerAndGyroscope();
      
      // Setup magnetometer listener
      this.setupMagnetometer();
      
      // Start sending data at the specified sample rate
      this.intervalId = setInterval(() => {
        this.sendSensorData();
      }, 1000 / this.sampleRate);
      
      const deviceType = this.isIOS ? 'iOS' : 'Android';
      console.log(`${deviceType} IMU sensor started successfully with existing permissions`);
      return true;
    } catch (error) {
      console.error('Error starting IMU sensor without permission request:', error);
      return false;
    }
  }

  // Set up accelerometer and gyroscope listeners
  setupAccelerometerAndGyroscope() {
    window.addEventListener('devicemotion', (event) => {
      if (!this.isActive) return;
      
      // Get accelerometer data (in m/s²)
      if (event.acceleration) {
        // Both iOS and Android provide the same accelerometer data format
        this.accelerometerData = {
          x: event.acceleration.x || 0,
          y: event.acceleration.y || 0,
          z: event.acceleration.z || 0
        };
      } else if (event.accelerationIncludingGravity && this.isAndroid) {
        // Some Android devices may only provide accelerationIncludingGravity
        // This is a fallback, but note that this includes gravity which might need filtering
        this.accelerometerData = {
          x: event.accelerationIncludingGravity.x || 0,
          y: event.accelerationIncludingGravity.y || 0,
          z: event.accelerationIncludingGravity.z || 0
        };
      }
      
      // Get gyroscope data (in rad/s)
      if (event.rotationRate) {
        this.gyroscopeData = {
          alpha: event.rotationRate.alpha || 0, // rotation around z-axis
          beta: event.rotationRate.beta || 0,   // rotation around x-axis
          gamma: event.rotationRate.gamma || 0  // rotation around y-axis
        };
      }
    });
  }

  // Set up magnetometer listener
  setupMagnetometer() {
    window.addEventListener('deviceorientation', (event) => {
      if (!this.isActive) return;
      
      // Get magnetometer data from device orientation
      // alpha: compass heading (0-360 degrees, 0 = North)
      // beta: front-to-back tilt (-180 to 180 degrees)
      // gamma: left-to-right tilt (-90 to 90 degrees)
      
      // For magnetometer, we're primarily interested in the compass heading (alpha)
      // and whether the device has absolute orientation (webkitCompassHeading on iOS)
      
      if (event.absolute || event.webkitCompassHeading !== undefined) {
        // iOS provides webkitCompassHeading which is the true compass heading
        const heading = event.webkitCompassHeading !== undefined 
          ? event.webkitCompassHeading 
          : event.alpha;
        
        this.magnetometerData = {
          heading: heading || 0,
          x: event.beta || 0,   // front-to-back tilt
          y: event.gamma || 0,  // left-to-right tilt
          z: event.alpha || 0   // compass direction
        };
      } else {
        // Fallback for devices without absolute orientation
        this.magnetometerData = {
          heading: event.alpha || 0,
          x: event.beta || 0,
          y: event.gamma || 0,
          z: event.alpha || 0
        };
      }
    });
  }

  // Send collected sensor data through WebSocket
  sendSensorData() {
    // Support both ws and websocket properties for backward compatibility
    const socket = this.ws || this.websocket;
    if (!this.isActive || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const timestamp = Date.now();
    
    // Create a structured payload with accelerometer, gyroscope, and magnetometer data
    const payload = {
      imu: {
        timestamp: timestamp,
        accelerometer: this.accelerometerData,
        gyroscope: this.gyroscopeData,
        magnetometer: this.magnetometerData
      }
    };

    // Send as JSON
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error('Error sending IMU data:', error);
    }
  }

  // Check Android sensor availability
  checkAndroidSensorAvailability() {
    // Check if the device supports the required sensor events
    const hasDeviceMotion = 'ondevicemotion' in window;
    const hasDeviceOrientation = 'ondeviceorientation' in window;
    
    if (!hasDeviceMotion) {
      console.warn('Android device missing required DeviceMotion sensor events');
      return false;
    }
    
    if (!hasDeviceOrientation) {
      console.warn('Android device missing DeviceOrientation sensor events (magnetometer may not work)');
      // Don't return false as we can still use accelerometer and gyroscope
    }
    
    return true;
  }

  // Stop IMU data collection
  stopIMUSensor() {
    this.isActive = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    const deviceType = this.isIOS ? 'iOS' : this.isAndroid ? 'Android' : 'Unknown';
    console.log(`${deviceType} IMU sensor stopped`);
    return Promise.resolve();
  }
}

// Make the IMU manager available globally
window.IMUSensorManager = IMUSensorManager;