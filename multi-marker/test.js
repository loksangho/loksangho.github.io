import * as THREE from 'three';

let scene, camera, renderer, cube;

function init() {
    // Scene
    scene = new THREE.Scene();
    // Optional: Set a background color to make it obvious if something renders
    scene.background = new THREE.Color(0xAAAAAA); // Light gray background

    // Camera
    camera = new THREE.PerspectiveCamera(
        75, // FOV
        window.innerWidth / window.innerHeight, // Aspect Ratio
        0.1, // Near clipping plane
        1000 // Far clipping plane
    );
    camera.position.z = 5; // Position camera a bit back to see the cube at origin

    // Renderer
    const canvas = document.getElementById('myCanvas');
    if (!canvas) {
        console.error("Canvas element with ID 'myCanvas' not found!");
        return;
    }
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Cube
    const geometry = new THREE.BoxGeometry(1, 1, 1); // 1x1x1 cube
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green, no light needed
    cube = new THREE.Mesh(geometry, material);
    scene.add(cube); // Add cube to scene

    // Handle window resizing
    window.addEventListener('resize', onWindowResize, false);

    animate(); // Start the animation loop
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    // Optional: Rotate the cube to confirm it's rendering
    // cube.rotation.x += 0.01;
    // cube.rotation.y += 0.01;

    renderer.render(scene, camera);
}

init();
