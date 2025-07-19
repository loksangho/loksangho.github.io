// main.js - Modified to save marker profiles in memory instead of file download/upload.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FACEMESH_TESSELATION } from './face_mesh_data.js';
import { WebARRocksObjectThreeHelper } from './helpers/WebARRocksObjectThreeHelper.js';
import { WebARRocksMediaStreamAPIHelper } from './helpers/WebARRocksMediaStreamAPIHelper.js';

// Global variables
let scene, camera, renderer, video, faceLandmarker;
let faceMesh, textureCanvas, textureCanvasCtx, faceTexture;
let exportedMeshData = null;
const runningMode = "VIDEO";
let animationFrameId;
let currentMode = null;
let webARrocksGroupAdded = false;
let isWebARRocksReady = false;
let markerArray, markerNames, sceneGroup, globe, currentMarkerName;

// AR specific variables
let arToolkitSource, arToolkitContext;
let savedProfileData = null; // 💡 To store the marker profile in memory
const _settings = {
  nDetectsPerLoop: 0, // 0 -> adaptative

  loadNNOptions: {
    notHereFactor: 0.0,
    paramsPerLabel: {
      CUP: {
        thresholdDetect: 0.92
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

  NNPath: './neuralNets/NN_COFFEE_2.json',

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
        if (!window.THREE.EventDispatcher) { window.THREE.EventDispatcher = THREE.ObjectD; }
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

        //await loadLegacyScript('https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar-threex.js');
        
        // 💡 Add the resize event listener globally

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

    var tempModule = window.Module || {};

    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode, numFaces: 1 });

    window.Module = tempModule; // Restore the original Module if it was set

    
    const geometry = new THREE.BufferGeometry();
    //geometry.attributes.position = new THREE.BufferAttribute(new Float32Array(478 * 3), 3);
    //geometry.attributes.uv = new THREE.BufferAttribute(new Float32Array(478 * 2));
    //geometry.index = new THREE.BufferAttribute(new Uint16Array(FACEMESH_TESSELATION.flat()));
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
    document.getElementById('playerButton').addEventListener('click', initCombinedPlayer);

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
        alert("Face mesh saved! Now, start the player.");
        document.getElementById('phase1').style.display = 'none';
        document.getElementById('phase2').style.display = 'block';
    }, (error) => console.error(error), { binary: true });
}


let _DOMVideo;
async function initCombinedPlayer() {
    currentMode = 'player';

    // Hide all UI phases
    document.getElementById('uiContainer').style.display = 'none';
    document.getElementById('phase1').style.display = 'none';
    const phase2 = document.getElementById('phase2');
    if (phase2) phase2.style.display = 'none';

    const canvas = document.getElementById('outputCanvas');
    canvas.style.display = 'none';


    scene = new THREE.Scene();

    let ambientLight = new THREE.AmbientLight(0xcccccc, 0.5);
    scene.add(ambientLight);

    camera = new THREE.Camera();
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setClearColor(new THREE.Color('lightgrey'), 0)
    renderer.setSize(800, 600);
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.top = '0px'
    renderer.domElement.style.left = '0px'
    document.body.appendChild(renderer.domElement);

    ////////////////////////////////////////////////////////////
    // setup arToolkitSource
    ////////////////////////////////////////////////////////////


    function onResize() {
        arToolkitSource.onResize()
        arToolkitSource.copySizeTo(renderer.domElement)
        if (arToolkitContext.arController !== null) {
            arToolkitSource.copySizeTo(arToolkitContext.arController.canvas)
        }
    }


    // 💡 Initialize ArToolkitSource with sourceType 'webcam'.
    // The library will now create the video element and get the camera stream by itself.
    arToolkitSource = new THREEx.ArToolkitSource({
        sourceType: 'webcam',
    });

    arToolkitSource.init(() => {
        // This log should now appear correctly
        console.log("AR source initialized.");

        onResize();

        // The library creates its own video element, which is accessed via .domElement
        // We just need to wait for it to be ready and then we can use it.
        // The onReady callback of init() is the right place to do this.
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        
        // Note: The library automatically appends its video element to the body,
        // so we don't need to manually append arToolkitSource.domElement.


    });ß
    arToolkitContext = new THREEx.ArToolkitContext({
        cameraParametersUrl: 'https://raw.githack.com/AR-js-org/AR.js/master/data/data/camera_para.dat',
        detectionMode: 'mono',
        maxDetectionRate: 30, // Adjust as needed
    });


    arToolkitContext.init(function onCompleted() {
        

        camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix());

       
        _DOMVideo = document.getElementById('webcamVideo'); 
        WebARRocksMediaStreamAPIHelper.get(_DOMVideo, initWebARRocks, function(err){
            throw new Error('Cannot get video feed ' + err);
            }, {
            video: {
                width:  {min: 640, max: 1920, ideal: 1280},
                height: {min: 640, max: 1920, ideal: 720},
                facingMode: {ideal: 'environment'}
            },
            audio: false
        });

        console.log("AR context initialized.");

        
    });
    markerNames = ["hiro", "kanji", "letterA"];

    markerArray = [];

    for (let i = 0; i < markerNames.length; i++) {
        let marker = new THREE.Group();
        scene.add(marker);
        markerArray.push(marker);

        let markerControls = new THREEx.ArMarkerControls(arToolkitContext, marker, {
            type: 'pattern',
            patternUrl: "./patt/" + markerNames[i] + ".patt",
        });

        let markerGroup = new THREE.Group();
        marker.add(markerGroup);
    }

    ////////////////////////////////////////////////////////////
    // setup scene
    ////////////////////////////////////////////////////////////

    sceneGroup = new THREE.Group();

    let loader = new THREE.TextureLoader();

    let geometry1 = new THREE.SphereGeometry(1, 32, 32);
    let texture = loader.load('images/earth-sphere.jpg');
    let material1 = new THREE.MeshLambertMaterial({
        map: texture,
        opacity: 0.75
    });
    globe = new THREE.Mesh(geometry1, material1);
    globe.position.y = 1;
    sceneGroup.add(globe);

    markerArray[0].children[0].add(sceneGroup);
    currentMarkerName = markerNames[0];

    let pointLight = new THREE.PointLight(0xffffff, 1, 50);
    camera.add(pointLight);

    console.log("ARContext initialised");
}

function initWebARRocks(){
    const ARCanvas = document.getElementById('ARCanvas');
    const threeCanvas = document.getElementById('threeCanvas');
    
    

    WebARRocksObjectThreeHelper.init({
        video: _DOMVideo,
        ARCanvas: ARCanvas,
        threeCanvas: threeCanvas,
        NNPath: _settings.NNPath,
        callbackReady: startWebARRocks,
        loadNNOptions: _settings.loadNNOptions,
        nDetectsPerLoop: _settings.nDetectsPerLoop,
        detectOptions: _settings.detectOptions,
        cameraFov: _settings.cameraFov,
        followZRot: _settings.followZRot,
        scanSettings: _settings.scanSettings,
        isFullScreen: true,
        stabilizerOptions: {}
    });

  console.log("init config", {
    video: renderer.domElement,
    threeCanvas: renderer.domElement,
    NNPath: _settings.NNPath
    });
}

function startWebARRocks(err, three) {
    if (err) {
        console.error("Error in WebAR.rocks initialization:", err);
        return;
    }

    // Add lighting to the AR Scene
    three.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const arDirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    arDirLight.position.set(0, 1, 1);
    three.scene.add(arDirLight);

    if (exportedMeshData) {
        const loader = new GLTFLoader();

        // CORRECT: Pass an empty string for the path (2nd argument),
        // so your callback is the 3rd argument (onLoad).
        loader.parse(exportedMeshData, '', function (gltf) {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(1, 1, 1);

            
            // Access classic script helper via the 'window' object
            WebARRocksObjectThreeHelper.add('CUP', loadedMesh);
             
        }, function (error) {
            console.error('An error happened during GLTF parsing:', error);
        });

    } else {
        // Fallback to a cube if no mesh was saved
        const arCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshNormalMaterial());
        WebARRocksObjectThreeHelper.add('CUP', arCube);
        alert("No mesh data found, showing a debug cube instead.");
    }
    isWebARRocksReady = true;
    animateCombined();
}

function update() {

    globe.rotation.y += 0.01;

    let anyMarkerVisible = false;
    for (let i = 0; i < markerArray.length; i++) {
        if (markerArray[i].visible) {
            anyMarkerVisible = true;
            console.log("Marker " + markerNames[i] + " is visible.");
            markerArray[i].children[0].add(sceneGroup);
            if (currentMarkerName != markerNames[i]) {
                currentMarkerName = markerNames[i];
                // console.log("Switching to " + currentMarkerName);
            }

            let p = markerArray[i].children[0].getWorldPosition();
            let q = markerArray[i].children[0].getWorldQuaternion();
            let s = markerArray[i].children[0].getWorldScale();
            let lerpAmount = 0.5;

            scene.add(sceneGroup);
            sceneGroup.position.lerp(p, lerpAmount);
            sceneGroup.quaternion.slerp(q, lerpAmount);
            sceneGroup.scale.lerp(s, lerpAmount);

            break;
        }
    }



    if (!anyMarkerVisible) {
        console.log("No marker currently visible."); 
    }

    let baseMarker = markerArray[0];

    // update relative positions of markers
    for (let i = 1; i < markerArray.length; i++) {
        let currentMarker = markerArray[i];
        let currentGroup = currentMarker.children[0];
        if (baseMarker.visible && currentMarker.visible) {
            // console.log("updating marker " + i " -> base offset");

            let relativePosition = currentMarker.worldToLocal(baseMarker.position.clone());
            currentGroup.position.copy(relativePosition);

            let relativeRotation = currentMarker.quaternion.clone().inverse().multiply(baseMarker.quaternion.clone());
            currentGroup.quaternion.copy(relativeRotation);
        }
    }

    // update artoolkit on every frame
    if (arToolkitSource.ready !== false)
        arToolkitContext.update(arToolkitSource.domElement);

}

function animateCombined() {
    if (currentMode !== 'player') return;
    animationFrameId = requestAnimationFrame(animateCombined);
    
    update();

    /*if (arToolkitSource && arToolkitSource.ready) { 
        arToolkitContext.update(arToolkitSource.domElement); 
        if (multiMarkerControls) {
            multiMarkerControls.update();
        }
    }*/

    // Update WebARRocks - it processes the video and updates its internal object poses
    if (isWebARRocksReady) {
        try {
        if (WebARRocksObjectThreeHelper.object3D && !webARrocksGroupAdded) {
            scene.add(WebARRocksObjectThreeHelper.object3D);
            webARrocksGroupAdded = true;
        }

        WebARRocksObjectThreeHelper.animate();
        } catch (e) {
        console.warn("WebARRocks animate error:", e);
        }
    }

    renderer.render(scene, camera);
}

function animate() {
    if (currentMode !== 'mediapipe') return;
    animationFrameId = requestAnimationFrame(animate);
    renderMediaPipe();
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