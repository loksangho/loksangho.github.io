/**
 * Copyright 2020 WebAR.rocks ( https://webar.rocks )
 * THIS IS A MODIFIED VERSION TO SUPPORT ES MODULES
 */

// STEP 1: Import THREE.js as a module.


// STEP 2: Remove the IIFE wrapper. The object is now a top-level const.
const _defaultSpec = {
  video: null,
  canvas: null,
  zOffset: 0.5,
  followZRot: false,
  isUseDeviceOrientation: false,
  deviceOrientationDOMTrigger: null,
  deviceOrientationDOMTriggerOnClick: null,
  deviceOrientationKeepRotYOnly: false,
  deviceOrientationEnableDelay: 30,
  nDetectsPerLoop: 0,
  detectOptions: null,
  scanSettings: null,
  isStabilized: false,
  stabilizerOptions: null,
  isFullScreen: false,
  cameraFov: 0,
  cameraMinVideoDimFov: 35,
  cameraZNear: 0.1,
  cameraZFar: 500
};

const _three = {
  renderer: null,
  containers: {},
  camera: null,
  scene: null,
  euler: null,
  quaternion: null,
  position: null
};

const _stabilizers = {};
const _videoRes = { width: -1, height: -1 };
const _deg2rad = Math.PI / 180;
const _deviceOrientation = {
  isEnabled: false,
  quatCamToWorld: null,
  quatObjToWorld: null,
  counter: 0
};

let _spec = null;
const _callbacks = {};

function init_deviceOrientation() {
  if (!_spec.isUseDeviceOrientation) {
    return Promise.reject();
  }
  // STEP 3: Explicitly access other classic scripts from the global 'window' object.
  if (typeof (window.DeviceOrientationHelper) === 'undefined') {
    throw new Error('Please include DeviceOrientationHelper.js to use isUseDeviceOrientation option');
  }
  return window.DeviceOrientationHelper.init({
    THREE: THREE,
    DOMTrigger: _spec.deviceOrientationDOMTrigger,
    DOMTriggerOnClick: _spec.deviceOrientationDOMTriggerOnClick,
    isRejectIfMissing: true,
    DOMRetryTrigger: _three.renderer.domElement,
    debugAlerts: false
  });
}

function update_orientationFromDeviceOrientation(quatObjToCam, quatTarget) {
  ++_deviceOrientation.counter;
  if (_deviceOrientation.counter < _spec.deviceOrientationEnableDelay) return;

  const quatWorldToCam = window.DeviceOrientationHelper.update();
  _deviceOrientation.quatCamToWorld.copy(quatWorldToCam).invert();

  if (_deviceOrientation.counter === _spec.deviceOrientationEnableDelay) {
    _deviceOrientation.quatObjToWorld.copy(quatObjToCam).premultiply(quatWorldToCam);
    if (_spec.deviceOrientationKeepRotYOnly) {
      const eulerOrder = 'YXZ';
      const eulerObjToWorld = new THREE.Euler().setFromQuaternion(_deviceOrientation.quatObjToWorld, eulerOrder);
      eulerObjToWorld.set(0.0, eulerObjToWorld.y, 0.0, eulerOrder);
      _deviceOrientation.quatObjToWorld.setFromEuler(eulerObjToWorld);
    }
  }

  quatTarget.copy(_deviceOrientation.quatObjToWorld).premultiply(_deviceOrientation.quatCamToWorld);
}

const WebARRocksObjectThreeHelper_Module = {
  init: function (spec) {
    _spec = Object.assign({}, _defaultSpec, spec, {
      isStabilized: (spec.stabilizerOptions !== undefined && typeof (window.WebARRocksThreeStabilizer) !== 'undefined') ? true : false
    });

    // STEP 3: Explicitly access other classic scripts from the global 'window' object.
    window.WEBARROCKSOBJECT.init({
      video: _spec.video,
      canvas: _spec.ARCanvas,
      followZRot: _spec.followZRot,
      scanSettings: _spec.scanSettings
    });

    _three.renderer = new THREE.WebGLRenderer({
      canvas: _spec.threeCanvas,
      alpha: true
    });
    _three.scene = new THREE.Scene();
    _three.camera = new THREE.PerspectiveCamera(_spec.cameraFov, _spec.threeCanvas.width / _spec.threeCanvas.height, _spec.cameraZNear, _spec.cameraZFar);
    _three.euler = new THREE.Euler(0, 0, 0, 'ZXY');
    _three.position = new THREE.Vector3();
    _three.quaternion = new THREE.Quaternion();

    window.WEBARROCKSOBJECT.set_NN(_spec.NNPath, (err) => {
      if (!err) {
        this.resize();
        init_deviceOrientation().then(() => {
          _deviceOrientation.isEnabled = true;
          _deviceOrientation.quatCamToWorld = new THREE.Quaternion();
          _deviceOrientation.quatObjToWorld = new THREE.Quaternion();
        }).catch(() => {
          console.log('Device Orientation API is not used');
        });
      }
      if (_spec.callbackReady) {
        _spec.callbackReady(err, _three);
      }
    }, _spec.loadNNOptions);
  },

  resize: function () {
    const canvas = _three.renderer.domElement;
    if (_spec.isFullScreen) {
      const dpr = window.devicePixelRatio || 1;
      const fsw = window.innerWidth;
      const fsh = screen.availHeight;
      canvas.width = fsw * dpr;
      canvas.height = fsh * dpr;
      canvas.style.width = fsw.toString() + 'px';
      canvas.style.height = fsh.toString() + 'px';
    }
    this.update_threeCamera();
  },

  animate: function () {
    const detectState = window.WEBARROCKSOBJECT.detect(_spec.nDetectsPerLoop, null, _spec.detectOptions);

    for (let label in _three.containers) {
      const threeContainer = _three.containers[label];

      if (!detectState.label || detectState.label !== label) {
        if (threeContainer.visible) {
          this.trigger_callback(label, 'onloose');
        }
        threeContainer.visible = false;
        _deviceOrientation.counter = 0;
        continue;
      }

      if (!threeContainer.visible) {
        if (_spec.isStabilized) _stabilizers[label].reset();
        this.trigger_callback(label, 'ondetect');
      }
      threeContainer.visible = true;

      const halfTanFOV = Math.tan(_three.camera.aspect * _three.camera.fov * _deg2rad / 2);
      const s = detectState.positionScale[2];
      const D = 1 / (2 * s * halfTanFOV);
      const xv = (2 * detectState.positionScale[0] - 1);
      const yv = (2 * detectState.positionScale[1] - 1);
      const z = -D - _spec.zOffset;
      const x = xv * D * halfTanFOV;
      const y = yv * D * halfTanFOV / _three.camera.aspect;
      _three.position.set(x, y, z);

      const dPitch = detectState.pitch - Math.PI / 2;
      _three.euler.set(-dPitch, detectState.yaw + Math.PI, -detectState.roll);
      _three.quaternion.setFromEuler(_three.euler);

      if (_spec.isStabilized) {
        _stabilizers[label].update(_three.position, _three.quaternion, detectState, _videoRes);
      } else {
        threeContainer.position.copy(_three.position);
        threeContainer.quaternion.copy(_three.quaternion);
      }

      if (_deviceOrientation.isEnabled) {
        update_orientationFromDeviceOrientation(threeContainer.quaternion, threeContainer.quaternion);
      }
    }
    _three.renderer.render(_three.scene, _three.camera);
  },

  add: function (label, threeStuff) {
    const isNew = !_three.containers[label];
    const threeContainer = (isNew) ? new THREE.Object3D() : _three.containers[label];
    _three.containers[label] = threeContainer;
    threeContainer.add(threeStuff);

    if (isNew) {
      _three.scene.add(threeContainer);
      if (_spec.isStabilized) {
        _stabilizers[label] = window.WebARRocksThreeStabilizer.instance({
          obj3D: threeContainer,
          ..._spec.stabilizerOptions
        });
      }
    }
  },

  set_callback: function (label, callbackType, callbackFunc) {
    if (!_callbacks[label]) {
      _callbacks[label] = { 'ondetect': null, 'onloose': null }
    }
    _callbacks[label][callbackType] = callbackFunc;
  },

  trigger_callback: function (label, callbackType, args) {
    if (_callbacks[label] && _callbacks[label][callbackType]) {
      _callbacks[label][callbackType](args);
    }
  },

  get_occluderMaterial: function () {
    return new THREE.ShaderMaterial({
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: "precision lowp float;\n void main(void){\n gl_FragColor = vec4(1.,0.,0.,1.);\n }",
      uniforms: THREE.ShaderLib.basic.uniforms,
      side: THREE.DoubleSide,
      colorWrite: false
    });
  },

  update_threeCamera: function () {
    const canvasElement = _three.renderer.domElement;
    const cvw = canvasElement.width;
    const cvh = canvasElement.height;
    const canvasAspectRatio = cvw / cvh;
    const vw = _spec.video.videoWidth;
    const vh = _spec.video.videoHeight;
    _videoRes.width = vw;
    _videoRes.height = vh;
    const videoAspectRatio = vw / vh;

    let fov = (_spec.cameraFov === 0)
      ? _spec.cameraMinVideoDimFov * ((vh > vw) ? (1.0 / videoAspectRatio) : 1.0)
      : _spec.cameraFov;
    fov = Math.min(fov, 60);

    let scale = (canvasAspectRatio > videoAspectRatio) ? (cvw / vw) : (cvh / vh);
    const cvws = vw * scale, cvhs = vh * scale;
    const offsetX = (cvws - cvw) / 2.0;
    const offsetY = (cvhs - cvh) / 2.0;

    _three.camera.aspect = videoAspectRatio;
    _three.camera.fov = fov;
    _three.camera.setViewOffset(cvws, cvhs, offsetX, offsetY, cvw, cvh);
    _three.camera.updateProjectionMatrix();

    _three.renderer.setSize(cvw, cvh, false);
    _three.renderer.setViewport(0, 0, cvw, cvh);
  }
};

// STEP 4: Export the helper object so it can be imported by other modules.
export const WebARRocksObjectThreeHelper = WebARRocksObjectThreeHelper_Module;