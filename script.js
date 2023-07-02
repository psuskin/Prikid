//Based on:
//"Realistic real-time grass rendering" by Eddie Lee, 2010
//https://www.eddietree.com/grass
//https://en.wikibooks.org/wiki/GLSL_Programming/Unity/Translucent_Surfaces

//There are two scenes: one for the sky/sun and another for the grass. The sky is rendered without depth information on a plane geometry that fills the screen. Automatic clearing is disabled and after the sky has been rendered, we draw the grass scene on top of the background. Both scenes share a camera and light direction information.

var canvas = document.getElementById("canvas");

const mobile = ( navigator.userAgent.match(/Android/i)
    || navigator.userAgent.match(/webOS/i)
    || navigator.userAgent.match(/iPhone/i)
    || navigator.userAgent.match(/BlackBerry/i)
    || navigator.userAgent.match(/Windows Phone/i)
    );

//Variables for blade mesh
var joints = 4;
var bladeWidth = 0.4;
var bladeHeight = 5.0;

//Patch side length
var width = 300;
//Number of vertices on ground plane side
var resolution = 64;
//Distance between two ground plane vertices
var delta = width/resolution;

//The global coordinates
//The geometry never leaves a box of width*width around (0, 0)
//But we track where in space the camera would be globally
var pos = new THREE.Vector2(0.01, 0.01);

//Number of blades
var instances = 80000;

//Initialise three.js. There are two scenes which are drawn after one another with clear() called manually at the start of each frame
//Grass scene
var scene = new THREE.Scene();

var renderer = new THREE.WebGLRenderer({antialias: true, canvas: canvas, alpha: true});
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize( window.innerWidth, window.innerHeight );

//Camera
var FOV = 45;
var camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 1, 20000);

camera.position.set(0, 160, 0);
camera.lookAt(new THREE.Vector3(0,0,0));

scene.add(camera);

window.addEventListener('resize', onWindowResize, false);
function onWindowResize(){
camera.aspect = window.innerWidth / window.innerHeight;
    renderer.setSize( window.innerWidth, window.innerHeight );
    camera.fov = FOV;
    camera.updateProjectionMatrix();
}

//Get alpha map and blade texture
//These have been taken from "https://cdn.skypack.dev/Realistic real-time grass rendering" by Eddie Lee, 2010
var loader = new THREE.TextureLoader();
loader.crossOrigin = '';
var noiseTexture = loader.load( 'https://al-ro.github.io/images/grass/perlinFbm.jpg' );
noiseTexture.wrapS = THREE.RepeatWrapping;
noiseTexture.wrapT = THREE.RepeatWrapping;

var sharedPrefix = `
uniform sampler2D noiseTexture;
float getYPosition(vec2 p){
	return 8.0*(2.0*texture2D(noiseTexture, p/800.0).r - 1.0);
}
`;

//************** Grass **************
var grassVertexSource = sharedPrefix + `
precision mediump float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 offset;
attribute vec2 uv;
attribute vec2 halfRootAngle;
attribute float scale;
attribute float index;
uniform float time;

uniform float delta;
uniform float posX;
uniform float posZ;
uniform float mousePosX;
uniform float mousePosY;
uniform float radius;
uniform float width;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying float frc;
varying float idx;

const float PI = 3.1415;
const float TWO_PI = 2.0 * PI;


//https://www.geeks3d.com/20141201/how-to-rotate-a-vertex-by-a-quaternion-in-glsl/
vec3 rotateVectorByQuaternion(vec3 v, vec4 q){
return 2.0 * cross(q.xyz, v * q.w + cross(q.xyz, v)) + v;
}

float placeOnSphere(vec3 v){
float theta = acos(v.z/radius);
float phi = acos(v.x/(radius * sin(theta)));
float sV = radius * sin(theta) * sin(phi);
//If undefined, set to default value
if(sV != sV){
    sV = v.y;
}
return sV;
}

void main() {

    //Vertex height in blade geometry
    frc = position.y / float(` + bladeHeight + `);

    //Scale vertices
vec3 vPosition = position;
    vPosition.y *= scale;

    //Invert scaling for normals
    vNormal = normal;
    vNormal.y /= scale;

    //Rotate blade around Y axis
vec4 direction = vec4(0.5, 0.0, 0.0, 0.0);
    vPosition = rotateVectorByQuaternion(vPosition, direction);
    vNormal = rotateVectorByQuaternion(vNormal, direction);

//UV for texture
vUv = uv;

    vec3 pos;
    vec3 globalPos;
    vec3 tile;

    globalPos.x = offset.x-posX*delta;
    globalPos.z = offset.z-posZ*delta;

    tile.x = floor((globalPos.x + 0.5 * width) / width);
    tile.z = floor((globalPos.z + 0.5 * width) / width);

    pos.x = globalPos.x - tile.x * width;
    pos.z = globalPos.z - tile.z * width;

    pos.y = max(0.0, placeOnSphere(pos)) - radius;
    pos.y += getYPosition(vec2(pos.x+delta*posX, pos.z+delta*posZ));
    
    //Position of the blade in the visible patch [0->1]
vec2 fractionalPos = 0.5 + offset.xz / width;
//To make it seamless, make it a multiple of 2*PI
fractionalPos *= TWO_PI;

//Wind is sine waves in time. 
float noise = 0.5 + 0.5 * sin(fractionalPos.x + time);
float halfAngle = -noise * 0.1;
noise = 0.5 + 0.5 * cos(fractionalPos.y + time);
halfAngle -= noise * 0.05;

    float distance = sqrt(pow(offset.x - mousePosX, 2.0) + pow(offset.z - mousePosY, 2.0));
    if (distance < 3.0) {
        direction = normalize(vec4(0.0, 0.0, 0.0, 0.0));
    }
    else {
        direction = normalize(vec4(sin(halfAngle), 0.0, -sin(halfAngle), cos(halfAngle)));
    }

    //Rotate blade and normals according to the wind
vPosition = rotateVectorByQuaternion(vPosition, direction);
    vNormal = rotateVectorByQuaternion(vNormal, direction);

    //Move vertex to global location
    vPosition += pos;

    //Index of instance for varying colour in fragment shader
    idx = index;

gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);

}`;

var grassFragmentSource = `
precision mediump float;

void main() {
vec3 col = vec3(0.0, 0.0, 0.0);

gl_FragColor = vec4(col, 1.0);
}`;

//Define base geometry that will be instanced. We use a plane for an individual blade of grass
var grassBaseGeometry = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, joints);
grassBaseGeometry.translate(0, bladeHeight/2, 0);

//Define the bend of the grass blade as the combination of three quaternion rotations
let vertex = new THREE.Vector3();
let quaternion0 = new THREE.Quaternion();
let quaternion1 = new THREE.Quaternion();
let x, y, z, w, angle, sinAngle, rotationAxis;

//Rotate around Y
angle = 0.05;
sinAngle = Math.sin(angle / 2.0);
rotationAxis = new THREE.Vector3(0, 1, 0);
x = rotationAxis.x * sinAngle;
y = rotationAxis.y * sinAngle;
z = rotationAxis.z * sinAngle;
w = Math.cos(angle / 2.0);
quaternion0.set(x, y, z, w);

//Rotate around X
angle = 0.3;
sinAngle = Math.sin(angle / 2.0);
rotationAxis.set(1, 0, 0);
x = rotationAxis.x * sinAngle;
y = rotationAxis.y * sinAngle;
z = rotationAxis.z * sinAngle;
w = Math.cos(angle / 2.0);
quaternion1.set(x, y, z, w);

//Combine rotations to a single quaternion
quaternion0.multiply(quaternion1);

//Rotate around Z
angle = 0.1;
sinAngle = Math.sin(angle / 2.0);
rotationAxis.set(0, 0, 1);
x = rotationAxis.x * sinAngle;
y = rotationAxis.y * sinAngle;
z = rotationAxis.z * sinAngle;
w = Math.cos(angle / 2.0);
quaternion1.set(x, y, z, w);

//Combine rotations to a single quaternion
quaternion0.multiply(quaternion1);

let quaternion2 = new THREE.Quaternion();

//Bend grass base geometry for more organic look
for(let v = 0; v < grassBaseGeometry.attributes.position.array.length; v += 3){
    quaternion2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    vertex.x = grassBaseGeometry.attributes.position.array[v];
    vertex.y = grassBaseGeometry.attributes.position.array[v+1];
    vertex.z = grassBaseGeometry.attributes.position.array[v+2];
    let frac = vertex.y/bladeHeight;
    quaternion2.slerp(quaternion0, frac);
    vertex.applyQuaternion(quaternion2);
    grassBaseGeometry.attributes.position.array[v] = vertex.x;
    grassBaseGeometry.attributes.position.array[v+1] = vertex.y;
    grassBaseGeometry.attributes.position.array[v+2] = vertex.z;
}

grassBaseGeometry.computeVertexNormals();
var baseMaterial = new THREE.MeshNormalMaterial({side: THREE.DoubleSide});
var baseBlade = new THREE.Mesh(grassBaseGeometry, baseMaterial);
//Show grass base geometry
//scene.add(baseBlade);

var instancedGeometry = new THREE.InstancedBufferGeometry();

instancedGeometry.index = grassBaseGeometry.index;
instancedGeometry.attributes.position = grassBaseGeometry.attributes.position;
instancedGeometry.attributes.uv = grassBaseGeometry.attributes.uv;
instancedGeometry.attributes.normal = grassBaseGeometry.attributes.normal;

// Each instance has its own data for position, orientation and scale
var indices = [];
var offsets = [];
var scales = [];
var halfRootAngles = [];

const scale = 0.4;

const degrees = 15;
const radians = (degrees * Math.PI) / 180;

const wOrig = 48;
const hOrig = 64;
const wRot = Math.abs(wOrig * Math.cos(radians)) + Math.abs(hOrig * Math.sin(radians))
const hRot = Math.abs(wOrig * Math.sin(radians)) + Math.abs(hOrig * Math.cos(radians))

const xCount = 1;
const yCount = 1;

function rotateCoordinates(xOrig, yOrig) {
    var cosTheta = Math.cos(radians);
    var sinTheta = Math.sin(radians);

    var xNew = xOrig * cosTheta - yOrig * sinTheta;
    var yNew = xOrig * sinTheta + yOrig * cosTheta;

    return { x: xNew, y: yNew };
}

const hemispheres = [1, -1];
function isInsideP(xOrig, yOrig) {
    const rotatedCoordinates = rotateCoordinates(xOrig, yOrig);
    let xNew = -rotatedCoordinates.x;
    let yNew = rotatedCoordinates.y

    if (xNew < (wOrig / 6) * scale && xNew > -(wOrig / 6) * scale && yNew < hOrig * scale && yNew > -hOrig * scale) {
        return true;
    }

    for (var i = 0; i < hemispheres.length; i++) {
        let xHem = xNew * hemispheres[i];
        let yHem = yNew * hemispheres[i];
        if (xHem > (wOrig / 6) * scale && yHem > 0 * scale && xHem < wOrig * scale && yHem < hOrig * scale) {
            if (xHem < (wOrig * 2 / 3) * scale && (yHem > (hOrig * 3 / 4) * scale || yHem < (hOrig / 4) * scale)) {
                return true;
            }

            if (xHem > (wOrig * 2 / 3) * scale && (yHem > (hOrig / 4) * scale && yHem < (hOrig * 3 / 4) * scale)) {
                return true;
            }

            if (xHem > (wOrig * 2 / 3) * scale && yHem > (hOrig * 3 / 4) * scale) {
                if (Math.pow(xHem - (wOrig * 2 / 3) * scale, 2) + Math.pow(yHem - (hOrig * 3 / 4) * scale, 2) < Math.pow((wOrig / 3) * scale, 2)) {
                    return true;
                }
            }

            if (xHem > 32 * scale && yHem < 16 * scale) {
                if (Math.pow(xHem - (wOrig * 2 / 3) * scale, 2) + Math.pow(yHem - (hOrig / 4) * scale, 2) < Math.pow((wOrig / 3) * scale, 2)) {
                    return true;
                }
            }
        }
    }

    return false;
}

function generateRandomP() {
    let xPos, yPos;
    do {
        xPos = (-wRot + Math.random() * wRot * 2) * scale;
        yPos = (-hRot + Math.random() * hRot * 2) * scale;
    } while (!isInsideP(xPos, yPos));

    let xOffset = (Math.floor(Math.random() * xCount) - (xCount / 2 - 0.5)) * wRot * scale * 1;
    let yOffset = (Math.floor(Math.random() * yCount) - (yCount / 2 - 0.5)) * hRot * scale * 1.85;

    xPos += xOffset;
    yPos += yOffset;
    
    return { x: xPos, y: yPos };
}

//For each instance of the grass blade
for (let i = 0; i < instances; i++){
    
    indices.push(i/instances);
    
    //Offset of the roots
    const randomCoords = generateRandomP();
    x = randomCoords.x;
    z = randomCoords.y;
    y = 0; 
    offsets.push(x, y, z);

        //Random orientation
    let angle = Math.PI - Math.random() * (2 * Math.PI);
    halfRootAngles.push(Math.sin(0.5*angle), Math.cos(0.5*angle));

    //Define variety in height
    if(i % 3 != 0){
        scales.push(2.0+Math.random() * 1.25);
    }else{
        scales.push(2.0+Math.random());
    }
}

var offsetAttribute = new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3);
var scaleAttribute = new THREE.InstancedBufferAttribute(new Float32Array(scales), 1);
var halfRootAngleAttribute = new THREE.InstancedBufferAttribute(new Float32Array(halfRootAngles), 2);
var indexAttribute = new THREE.InstancedBufferAttribute(new Float32Array(indices), 1);

instancedGeometry.setAttribute( 'offset', offsetAttribute);
instancedGeometry.setAttribute( 'scale', scaleAttribute);
instancedGeometry.setAttribute( 'halfRootAngle', halfRootAngleAttribute);
// instancedGeometry.setAttribute( 'index', indexAttribute);

//Define the material, specifying attributes, uniforms, shaders etc.
var grassMaterial = new THREE.RawShaderMaterial( {
uniforms: {
    time: {type: 'float', value: 0},
        delta: {type: 'float', value: delta },
    posX: {type: 'float', value: pos.x },
    posZ: {type: 'float', value: pos.y },
    mousePosX: {type: 'float', value: 0 },
    mousePosY: {type: 'float', value: 0 },
    width: {type: 'float', value: width },
    // map: { value: grassTexture},
    // alphaMap: { value: alphaMap},
    noiseTexture: { value: noiseTexture},
        cameraPosition: {type: 'vec3', value: camera.position},
},
vertexShader: grassVertexSource,
fragmentShader: grassFragmentSource,
side: THREE.DoubleSide
} );

var grass = new THREE.Mesh(instancedGeometry, grassMaterial);
scene.add(grass);

window.addEventListener('mousemove', onMouseMove, false);

camera.lookAt(0, 0, 0);
let p1 = new THREE.Vector3(1, 0, 1).project(camera);
const xMax = 1 / p1.x
const yMax = 1 / p1.y
function onMouseMove(event) {
    const mouseX = (event.clientX / window.innerWidth) * 2 * xMax - xMax;
    const mouseY = -((event.clientY / window.innerHeight) * 2 * yMax - yMax);

    grassMaterial.uniforms.mousePosX.value = mouseX;
    grassMaterial.uniforms.mousePosY.value = mouseY;
}

//************** Draw **************
var time = 0;
var lastFrame = Date.now();
var thisFrame;
var dT = 0;

function draw(){
    // stats.begin();
    
    //Update time
    thisFrame = Date.now();
    dT = (thisFrame - lastFrame)/200.0;
    time += dT;	
    // move(dT);
    lastFrame = thisFrame;
    
grassMaterial.uniforms.time.value = time;
    
    renderer.clear();
    renderer.render(scene, camera);
// stats.end();
requestAnimationFrame(draw);
}

draw();