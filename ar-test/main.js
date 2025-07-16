// main.js - Final Classic Script Version

// Use the global 'vision' object from MediaPipe
const { FaceLandmarker, FilesetResolver } = vision;

// Global variables for the app
let video, faceLandmarker;
let faceGeometry, faceMaterial;
let exportedMeshData = null;

const _settings = {
  NNPath: './neuralNets/NN_KEYBOARD_5.json'
};

async function init() {
    console.log("init() started: Data Capture Phase");

    // Phase 1: Use MediaPipe to capture face data without rendering a scene.
    video = document.getElementById('webcamVideo');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
    } catch (e) {
        alert('Could not access webcam. Please grant permission.');
        return;
    }
    
    const visionResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(visionResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` },
        runningMode: "VIDEO",
        outputFacialTransformationMatrixes: true,
        numFaces: 1
    });

    // Setup the geometry and material objects, but don't add them to a scene yet.
    faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(478 * 3), 3));
    faceGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(478 * 2), 2));
    faceGeometry.setIndex(FACEMESH_TESSELATION.flat());
    faceMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });

    // Setup UI
    document.getElementById('loading').style.display = 'none';
    document.getElementById('uiContainer').style.display = 'flex';
    document.getElementById('saveButton').addEventListener('click', captureAndSaveMesh);
    document.getElementById('arButton').addEventListener('click', mainWebARRocks);
}

function captureAndSaveMesh() {
    console.log("Attempting to capture face mesh...");
    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        const positions = faceGeometry.attributes.position.array;
        const uvs = faceGeometry.attributes.uv.array;

        for (let i = 0; i < landmarks.length; i++) {
            positions[i * 3] = landmarks[i].x;
            positions[i * 3 + 1] = landmarks[i].y;
            positions[i * 3 + 2] = landmarks[i].z;
            uvs[i * 2] = landmarks[i].x;
            uvs[i * 2 + 1] = 1.0 - landmarks[i].y;
        }
        faceGeometry.attributes.position.needsUpdate = true;
        faceGeometry.attributes.uv.needsUpdate = true;
        faceGeometry.computeVertexNormals();

        // Create a temporary mesh to export
        const tempMesh = new THREE.Mesh(faceGeometry, faceMaterial);
        const exporter = new THREE.GLTFExporter();
        
        exporter.parse(tempMesh, (gltf) => {
            exportedMeshData = gltf;
            alert("Face mesh saved successfully! You can now start AR.");
            document.getElementById('arButton').style.display = 'block';
        }, (error) => console.error(error), { binary: true });
        
    } else {
        alert("No face detected. Please position your face in the camera and try again.");
    }
}

function mainWebARRocks() {
    console.log("mainWebARRocks() started: AR Phase");
    document.getElementById('uiContainer').style.display = 'none';

    // Stop the user-facing camera
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); }

    // Start AR with the rear camera
    WebARRocksMediaStreamAPIHelper.get(video, initWebARRocks, (err) => {
        alert("Could not access rear camera. Please grant permission.");
        console.error(err);
    }, { video: { facingMode: { ideal: 'environment' } } });
}

function initWebARRocks() {
    console.log("initWebARRocks()");
    
    // Let the helper initialize the one and only renderer and scene
    WebARRocksObjectThreeHelper.init({
        video: video,
        ARCanvas: document.getElementById('ARCanvas'),
        threeCanvas: document.getElementById('threeCanvas'),
        NNPath: _settings.NNPath,
        callbackReady: startWebARRocks
    });
}

function startWebARRocks(err, three) {
    if (err) {
        console.error("Error in startWebARRocks: ", err);
        return;
    }
    console.log("startWebARRocks(): WebAR.rocks is ready.");

    // Add lighting to the AR Scene created by the helper
    three.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const arDirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    arDirLight.position.set(0, 1, 1);
    three.scene.add(arDirLight);

    // Load the saved mesh data into the AR scene
    if (exportedMeshData) {
        const loader = new THREE.GLTFLoader();
        loader.parse(exportedMeshData, (gltf) => {
            const loadedMesh = gltf.scene;
            loadedMesh.scale.set(0.2, 0.2, 0.2);
            WebARRocksObjectThreeHelper.add('KEYBOARD', loadedMesh);
        });
    } else {
        // Fallback to a cube if no mesh was saved
        const arCube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshNormalMaterial());
        WebARRocksObjectThreeHelper.add('KEYBOARD', arCube);
        alert("No mesh data found, showing a debug cube instead.");
    }

    // Start the animation loop managed by the helper
    function animateAR() {
        WebARRocksObjectThreeHelper.animate();
        requestAnimationFrame(animateAR);
    }
    animateAR();
}

// Start the application in Phase 1
init();
