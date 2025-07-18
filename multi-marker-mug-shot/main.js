// main.js - Modified to save marker profiles in memory instead of file download/upload.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';

// Global variables
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
const runningMode = "VIDEO";
let animationFrameId;
let currentMode = null;
let webARrocksGroupAdded = false;

// AR specific variables
let arToolkitSource, arToolkitContext, multiMarkerControls, multiMarkerLearning;
let savedProfileData = null; // 💡 To store the marker profile in memory
const _settings = {
  nDetectsPerLoop: 0, // 0 -> adaptative

  loadNNOptions: {
    notHereFactor: 0.0,
    paramsPerLabel: {
      CUP: {
        thresholdDetect: 0.52
      }
    }
  },

  detectOptions: {
    isKeepTracking: true,
    isSkipConfirmation: false,
    thresholdDetectFactor: 1,
    cutShader: 'median',
    thresholdDetectFactorUnstitch: 0.2,
    trackingFactors: [0.5, 0.4, 1.5]
  },

  NNPath: './neuralNets/NN_COFFEE_0.json',

  cameraFov: 0, // In degrees, camera vertical FoV. 0 -> auto mode
  scanSettings:{
    nScaleLevels: 2,
    scale0Factor: 0.8,
    overlapFactors: [2, 2, 2], // between 0 (max overlap) and 1 (no overlap). Along X,Y,S
    scanCenterFirst: true    
  },

  followZRot: true,

  displayDebugCylinder: false
};

function loadLegacyScript(url) {
    return new Promise((resolve, reject) => {
        window.THREE = THREE;
        if (!window.THREE.EventDispatcher) { window.THREE.EventDispatcher = THREE.Object3D; }
        if (!window.THREE.Matrix4.prototype.getInverse) {
            window.THREE.Matrix4.prototype.getInverse = function(matrix) { return this.copy(matrix).invert(); };
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function main() {
    try {
        await loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js');
        
        // 💡 Add the resize event listener globally
        window.addEventListener('resize', onResize, false);

        initMediaPipe();
    } catch (error) {
        console.error("Error loading ar-threex.js:", error);
    }
}

async function initMediaPipe() {
    currentMode = 'mediapipe';
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2.5;
    const canvas = document.getElementById('outputCanvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.style.display = 'block';
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0, 1, 1);
    scene.add(dirLight);
    video = document.getElementById('webcamVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
    video.style.display = 'none';
    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode, numFaces: 1 });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(478 * 2), 2));
    geometry.setIndex(FACEMESH_TESSELATION.flat());
    textureCanvas = document.createElement('canvas');
    textureCanvas.width = 512; textureCanvas.height = 512;
    textureCanvasCtx = textureCanvas.getContext('2d');
    faceTexture = new THREE.CanvasTexture(textureCanvas);
    const material = new THREE.MeshStandardMaterial({ map: faceTexture, side: THREE.DoubleSide });
    faceMesh = new THREE.Mesh(geometry, material);
    scene.add(faceMesh);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('phase1').style.display = 'block';
    document.getElementById('saveButton').addEventListener('click', saveMesh);
    document.getElementById('learnerButton').addEventListener('click', initLearner);

    // 💡 REMOVED playerButton and profileInput logic, as player is now started from the learner.
    
    animate();
}

function saveMesh() {
    if (currentMode !== 'mediapipe' || !faceLandmarker) return;
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceLandmarks.length === 0) { alert("No face detected. Please look at the camera."); return; }
    const exporter = new GLTFExporter();
    exporter.parse(faceMesh, (gltf) => {
        exportedMeshData = gltf;
        alert("Face mesh saved! Now, start the learner.");
        document.getElementById('phase1').style.display = 'none';
        document.getElementById('phase2').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}

function cleanup() {
    cancelAnimationFrame(animationFrameId);
    if (video && video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); video.srcObject = null; }
    if (renderer) {
        renderer.dispose();
        renderer = null;
    }
    if (currentMode === 'player') { 
        WebARRocksObjectThreeHelper.destroy();
        webARrocksGroupAdded = false;
    }
    const dynamicUI = document.getElementById('dynamicUI');
    if(dynamicUI) dynamicUI.remove();
}

function initLearner() {
    cleanup();
    currentMode = 'learner';
    const canvas = document.getElementById('outputCanvas');
    canvas.style.display = 'block';
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    arToolkitSource = new THREEx.ArToolkitSource({ sourceType: 'webcam' });
    arToolkitSource.init(() => {
        onResize();

        setTimeout(() => {
            arToolkitSource.onResizeElement();
            arToolkitSource.copyElementSizeTo(renderer.domElement);
        }, 100);
    });
    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
    });
    arToolkitContext.init(() => camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix()));
    const subMarkersControls = [];
    const markerNames = ['hiro', 'kanji', 'letterA'];

    markerNames.forEach(function(markerName){
        const markerRoot = new THREE.Group();
        scene.add(markerRoot);
        const markerControls = new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
            type: 'pattern',
            patternUrl: `./patt/patt.${markerName}`,
        });
        const markerHelper = new THREEx.ArMarkerHelper(markerControls);
        markerControls.object3d.add(markerHelper.object3d);
        subMarkersControls.push(markerControls);
    });
    multiMarkerLearning = new THREEx.ArMultiMakersLearning(arToolkitContext, subMarkersControls);
    multiMarkerLearning.enabled = true;

    // --- MODIFIED UI FOR LEARNING STATUS ---
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dynamicUI';
    controlsContainer.style.cssText = 'position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.5); padding: 10px; border-radius: 5px; color: white;';
    // 💡 Changed button to "Save Profile & Start Player"
    controlsContainer.innerHTML = `
        <button id="resetBtn">Reset Learning</button>
        <button id="saveAndPlayBtn">Save Profile & Start Player</button>
        <div style="margin-top: 10px;">Status: <span id="learningStatus" style="font-weight: bold; color: red;">In Progress...</span></div>
    `;
    document.body.appendChild(controlsContainer);
    document.getElementById('resetBtn').onclick = () => multiMarkerLearning.resetStats();
    
    // --- MODIFIED BUTTON LOGIC TO SAVE TO MEMORY AND START PLAYER ---
    document.getElementById('saveAndPlayBtn').onclick = () => {
        const profileData = JSON.parse(multiMarkerLearning.toJSON());
        
        if (!profileData || !profileData.subMarkersControls || profileData.subMarkersControls.length < markerNames.length) {
            alert(`Learning not complete! Please show all markers to the camera until the status is 'Ready'.`);
            return;
        }

        profileData.parameters = {
            type: 'area'
        };
        
        // 💡 Save data to memory variable instead of downloading a file
        savedProfileData = profileData;
        alert("Profile saved to memory. Starting the player...");
        
        

        // 💡 Directly initialize the player with the saved data
        initCombinedPlayer(savedProfileData);
    };
    
    animateAR();
}

// --- CORRECTED STATE-AWARE RESIZE HANDLER ---
function onResize() {
    if (!renderer) return;

    if (currentMode === 'mediapipe') {
        // In MediaPipe mode, we control the perspective camera.
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    } else {
        // In 'learner' or 'player' mode, AR.js handles resizing.
        if (arToolkitSource && arToolkitSource.ready) {
            arToolkitSource.onResizeElement();
            arToolkitSource.copyElementSizeTo(renderer.domElement);
            if (arToolkitContext && arToolkitContext.arController !== null) {
                arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
            }
        }
    }
}


async function initCombinedPlayer(profileData) {
    cleanup();
    currentMode = 'player';

    // Hide all UI phases
    document.getElementById('uiContainer').style.display = 'none';
    document.getElementById('phase1').style.display = 'none';
    document.getElementById('phase2').style.display = 'none';
    const phase3 = document.getElementById('phase3');
    if (phase3) phase3.style.display = 'none';

    const canvas = document.getElementById('outputCanvas');
    canvas.style.display = 'block';
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const gl = renderer.getContext();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.7));

    // 💡 REMOVED all manual <video> element and getUserMedia code.
    // 2. --- Shared Video Stream ---
    // We create ONE video element and get the camera stream ONCE.
    /*video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: {ideal: 1280}, height: {ideal: 720} }
    });
    video.srcObject = stream;
    document.body.appendChild(video);
    video.style.position = 'absolute';
    video.style.top = '0';
    video.style.left = '0';
    video.style.zIndex = '-1'; // Hide video behind canvas
    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    video.play();*/



    // 💡 Initialize ArToolkitSource with sourceType 'webcam'.
    // The library will now create the video element and get the camera stream by itself.
    arToolkitSource = new THREEx.ArToolkitSource({
        sourceType: 'webcam',
        sourceElement: renderer.domElement
    });

    arToolkitSource.init(() => {
        // This log should now appear correctly
        console.log("AR source initialized.");

        // The library creates its own video element, which is accessed via .domElement
        // We just need to wait for it to be ready and then we can use it.
        // The onReady callback of init() is the right place to do this.
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        
        // Note: The library automatically appends its video element to the body,
        // so we don't need to manually append arToolkitSource.domElement.

        arToolkitContext = new THREEx.ArToolkitContext({
            cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
            detectionMode: 'mono'
        });

        arToolkitContext.init(() => {
            camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());

            const markerRoot = new THREE.Group();
            scene.add(markerRoot);

            multiMarkerControls = THREEx.ArMultiMarkerControls.fromJSON(arToolkitContext, scene, markerRoot, JSON.stringify(profileData));

            const arjsObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 'red' }));
            arjsObject.position.y = 0.5;
            markerRoot.add(arjsObject);

            // 4. --- Initialize WebARRocks (as slave) ---
            // It ALSO uses the shared video element, and we tell it to use our main scene.
            // --- CORRECTED WEBARROCKS INIT ---
            const arCanvas = document.getElementById('ARCanvas');
            WebARRocksObjectThreeHelper.init({
                video: video,
                NNPath: _settings.NNPath,
                ARCanvas: arCanvas,
                threeCanvas: canvas, // <-- This was the missing property
                callbackReady: (err, three) => {
                    if (err) { console.error(err); return; }
                    if (exportedMeshData) {
                        new GLTFLoader().parse(exportedMeshData, '', (gltf) => {
                            if (gltf && gltf.scene) {
                                gltf.scene.scale.set(1, 1, 1);
                                WebARRocksObjectThreeHelper.add('CUP', gltf.scene);
                            }
                        });
                    } else { 
                        WebARRocksObjectThreeHelper.add('CUP', new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), new THREE.MeshNormalMaterial())); 
                    }
                },
                loadNNOptions: _settings.loadNNOptions,
                nDetectsPerLoop: _settings.nDetectsPerLoop,
                detectOptions: _settings.detectOptions,
                cameraFov: _settings.cameraFov,
                followZRot: _settings.followZRot,
                scanSettings: _settings.scanSettings,
                isFullScreen: true,
                stabilizerOptions: {}
            });

            const markerHelper = new THREEx.ArMarkerHelper(multiMarkerControls);
            markerRoot.add(markerHelper.object3d);

            console.log("AR setup complete. Starting animation loop.");
            animateCombined();
        });
    });
}

function animateCombined() {
    if (currentMode !== 'player') return;
    animationFrameId = requestAnimationFrame(animateCombined);
    
    if (arToolkitSource && arToolkitSource.ready) { 
        arToolkitContext.update(arToolkitSource.domElement); 
    }

    if (WebARRocksObjectThreeHelper.object3D && !webARrocksGroupAdded) {
        scene.add(WebARRocksObjectThreeHelper.object3D);
        webARrocksGroupAdded = true;
    }
    WebARRocksObjectThreeHelper.animate();

    renderer.render(scene, camera);
}

function animate() {
    if (currentMode !== 'mediapipe') return;
    animationFrameId = requestAnimationFrame(animate);
    renderMediaPipe();
}

function animateAR() {
    if (currentMode !== 'learner') return;
    animationFrameId = requestAnimationFrame(animateAR);
    if (!arToolkitSource || !arToolkitSource.ready) return;
    arToolkitContext.update(arToolkitSource.domElement);
    
    if (multiMarkerLearning) {
        multiMarkerLearning.computeResult();
        const statusElement = document.getElementById('learningStatus');
        if (statusElement) {
            let nMarkersLearned = 0;
            multiMarkerLearning.subMarkersControls.forEach(function(markerControls) {
                if (markerControls.object3d.userData.result === undefined) return;
                if (markerControls.object3d.userData.result.confidenceFactor < 1) return;
                nMarkersLearned++;
            });

            if (nMarkersLearned === multiMarkerLearning.subMarkersControls.length) {
                statusElement.innerHTML = 'Ready to Start Player!';
                statusElement.style.color = 'lightgreen';
            } else {
                statusElement.innerHTML = `In Progress... (${nMarkersLearned}/${multiMarkerLearning.subMarkersControls.length})`;
                statusElement.style.color = 'red';
            }
        }
    }
    renderer.render(scene, camera);
}

let lastVideoTime = -1;
function renderMediaPipe() {
    if (video && faceLandmarker && video.readyState === video.HAVE_ENOUGH_DATA && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = faceLandmarker.detectForVideo(video, performance.now());
        if (results.faceLandmarks.length > 0) {
            faceMesh.visible = true;
            const landmarks = results.faceLandmarks[0];
            const positions = faceMesh.geometry.attributes.position.array;
            const uvs = faceMesh.geometry.attributes.uv.array;
            for (let i = 0; i < landmarks.length; i++) {
                positions[i * 3]     = (landmarks[i].x - 0.5) * 2;
                positions[i * 3 + 1] = -(landmarks[i].y - 0.5) * 2;
                positions[i * 3 + 2] = -landmarks[i].z;
                uvs[i * 2]           = landmarks[i].x;
                uvs[i * 2 + 1]       = 1.0 - landmarks[i].y;
            }
            faceMesh.geometry.attributes.position.needsUpdate = true;
            faceMesh.geometry.attributes.uv.needsUpdate = true;
            faceMesh.geometry.computeVertexNormals();
            textureCanvasCtx.clearRect(0, 0, 512, 512);
            textureCanvasCtx.drawImage(video, 0, 0, 512, 512);
            faceTexture.needsUpdate = true;
        } else { faceMesh.visible = false; }
    }
    if (renderer) renderer.render(scene, camera);
}

main();