// Constants and variables definitions
const serverAddress = 'localhost'; // MQTT server address
const serverPort = 3000; // MQTT server port (using websocket)
const xAxisNum = 11; // Maximum number of X axis categories for all charts

// MQTT Setup
const client = mqtt.connect('ws://' + serverAddress + ':' + serverPort);

// Subscribe to some topics
client.subscribe('status/#');
client.subscribe('set/illuminance/+');

// Get elements
let uploadForm = document.querySelector('form.section');
let uploadInput = document.querySelector('[name=upload]');
let illuminances = {};
let lamps = {};
let chartsData = {};
document.querySelectorAll('.illuminance').forEach(function(element){
    illuminances[element.id] = element;
});
document.querySelectorAll('.lamp').forEach(function(element){
    lamps[element.id] = element;
});
document.querySelectorAll('.chart').forEach(function(element){
    chartsData[element.id] = [];
    new ApexCharts(element, genChartOpts(element.id)).render();
});

// Function definitions
function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? '0' + hex : hex;
}  
function rgbToHex(r, g, b) {
    return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}
function invertRgb(colorObj) {
    return Object.keys(colorObj).length != 0 && colorObj.constructor === Object ? {
        r: 255 - colorObj.r,
        g: 255 - colorObj.g,
        b: 255 - colorObj.b
    } : null;
}
// function colorPreview(event) {
//     lamps[event.target.id].textContent = '';
//     lamps[event.target.id].style.backgroundColor = event.target.value;
// }
function colorSet(event) {
    const color = hexToRgb(event.target.value);
    const r = String(color.r);
    const g = String(color.g);
    const b = String(color.b);
    client.publish('set/lamp/' + event.target.id + '/red' , r, {retain: true});
    client.publish('set/lamp/' + event.target.id + '/green' , g, {retain: true});
    client.publish('set/lamp/' + event.target.id + '/blue' , b, {retain: true});
    // lamps[event.target.id].textContent = '...';
    // lamps[event.target.id].style.backgroundColor = event.target.value;
    // // Invert the text color so it's readable
    // const inverted = invertRgb(color);
    // const invertedStr = 'rgb(' + inverted.r + ', ' + inverted.g + ', ' + inverted.b + ')';
    // lamps[event.target.id].style.color = invertedStr;
}
function updateLamp(area, payload) {
    // payload format sent from microcontroller is 'red|green|blue|brightness|ISO_timestamp' (string)
    const split = payload.split('|');
    const red = split[0];
    const green = split[1];
    const blue = split[2];
    const brightness = parseFloat(split[3]);
    lamps[area].textContent = Math.round(brightness).toString() + '%';
    lamps[area].style.backgroundColor = 'rgb(' + red + ', ' + green + ', ' + blue + ')';
    // Invert the text color so it's readable
    const inverted = invertRgb({r: red, g: green, b: blue});
    const invertedStr = 'rgb(' + inverted.r + ', ' + inverted.g + ', ' + inverted.b + ')';
    lamps[area].style.color = invertedStr;
    // Also update the color selector value
    const colorPicker = document.querySelector('#' + area + '[type="color"]');
    colorPicker.value = rgbToHex(parseInt(red), parseInt(green), parseInt(blue));
}
async function updateIlluminance(area, payload) {
    // payload format sent from microcontroller is 'lux|lux_target|lux_min|uniformity|ISO_timestamp' (string)
    const split = payload.split('|');
    const time = new Date(split[split.length-1]);
    const timeStr = ('0' + time.getHours()).slice(-2) + '.' + ('0' + time.getMinutes()).slice(-2);
    chartsData[area].push({x: timeStr, y: parseFloat(split[0])});
    if (chartsData[area].length > xAxisNum) chartsData[area].shift();
    // Using 'await' to update the chart data first before updating annotation
    await ApexCharts.exec(area, 'updateSeries', [{data: chartsData[area]}]);
    // Update the illuminance target annotation
    ApexCharts.exec(area, 'addYaxisAnnotation', {
        y: parseFloat(split[1]),
        strokeDashArray: 20,
        borderColor: '#e03c31',
        fillColor: '#e03c31',
        label: {
            text: 'Ē = ' + split[1] + ' lx',
            textAnchor: 'end',
            borderColor: '#e03c31',
            style: {
                background: '#e03c31',
                color: '#fff',
                fontWeight: 700,
                padding: {
                    left: 4,
                    right: 4
                }
            }
        }
    }, false);
    // Show the new iluminance value in the web page
    illuminances[area].textContent = split[0] + ' lx';
}
function upload(form) {
    // Create a new XMLHttpRequest (XHR) DOM object instance
    const XHR = new XMLHttpRequest();
    // Bind the FormData object and the form element
    const FD = new FormData(form);
    // Define what happens on successful data submission
    XHR.addEventListener('load', event => {
        alert(event.target.responseText);
        // Give some time for the server to extract the simulation images from
        // the uploaded pdfs and then refresh the displayed simulation images
        setTimeout(addImgNode, 10000, 'section-simulation');
    });
    // Define what happens in case of error
    XHR.addEventListener('error', event => {
        alert('Oops! Something went wrong.');
    });
    // Set up our request
    XHR.open('POST', '/upload');
    // The data sent is what the user provided in the form
    XHR.send(FD);
}
function addImgNode(id) {
    fetch('/get-images')
    .then(res => res.json())
    .then(async res => {
        if (res == []) return;
        if (res == ['building_layout.jpeg']) return;
        if (res == ['logo_cita.png']) return;
        if (res == ['building_layout.jpeg', 'logo_cita.png']) return;
        let parentNode = document.getElementById(id);
        // Empty the parent node first
        parentNode.textContent = '';
        const setpoints = await getSetpoints();
        if (setpoints == []) return;
        res.forEach((imgPath, index) => {
            // Skip unconverted image files (just in case)
            if (/-0[0-9]+\./.test(imgPath)) return;
            // Extract the time and area information first
            const baseNameNoExt = imgPath.slice(0, -6).split('/')[1];
            const split = baseNameNoExt.split('-');
            const time = split[0];
            const areaName = split[1].replace(/_+/g, ' '); // Just in case there are underscores
            // let title = areaName + ' (' + time + ', Ē = ';
            let title = areaName + ' (' + time + ', Tingkat Intensitas Cahaya Lampu = ';
            if (index % 2 == 0) {
                title += setpoints[index/2].brightness + '%, Ē = ';
                title += setpoints[index/2].illuminance + ' lx)';
            }
            else {
                title += setpoints[(index-1)/2].brightness + '%, Ē = ';
                title += setpoints[(index-1)/2].illuminance + ' lx)';
            }
            // Create the image node
            let imgElement = document.createElement('img');
            // Set the img source
            imgElement.setAttribute('src', imgPath);
            // Setting the appropriate alt text
            let altStr = 'Simulasi distribusi iluminansi di area ';
            altStr += title;
            imgElement.setAttribute('alt', altStr);
            // Set the class to 'image'
            imgElement.setAttribute('class', 'image');
            // Attach all new nodes to the parent node
            // Create only 1 title for each image pair (illuminance dist. and its legend)
            if (index % 2 == 0) {
                let titleElement = document.createElement('h2');
                titleElement.textContent = title;
                parentNode.appendChild(titleElement);
                
            }
            parentNode.appendChild(imgElement);
        });
    })
    .catch(err => console.error(err));
}
async function getSetpoints() {
    const res = await fetch('/get-setpoints');
    return res.json();
}
// Attaching functions to some events
document.querySelectorAll('[type=color]').forEach(function(element) {
    // element.addEventListener('input', colorPreview, false);
    element.addEventListener('change', colorSet, false);
});
uploadForm.addEventListener('submit', event => {
    event.preventDefault();
    upload(uploadForm);
    uploadInput.value = '';
});

// MQTT upon receive
client.on('message', function(topic, payload){
    const split = topic.split('/');
    const payloadStr = payload.toString();
    switch (split[0] + '/' + split[1]) {
        case 'status/lamp': updateLamp(split[2], payloadStr); break;
        case 'status/illuminance': updateIlluminance(split[2], payloadStr); break;
    }
});

// Show simulation results of all available setpoint values (taken from the uploaded pdf files)
addImgNode('section-simulation')