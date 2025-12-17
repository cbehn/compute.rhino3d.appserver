const fs = require('fs');
const fetch = require('node-fetch');

// 1. SETUP
const filename = 'simple test.gh'; // Make sure this matches your file name exactly
const computeUrl = 'http://52.186.121.135:80/';
const apiKey = '0bb5131f-1dc8-46c0-9c52-e3bf0b7c83a6';

async function runDebug() {
    console.log(`1. Reading ${filename}...`);
    
    try {
        // Read file into buffer
        const buffer = fs.readFileSync(filename);
        console.log(`   Size: ${buffer.length} bytes`);

        // Prepare URL
        const url = computeUrl + 'io';
        console.log(`2. Posting to ${url}...`);

        // Send Request
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'RhinoComputeKey': apiKey,
                'Content-Length': buffer.length.toString()
            },
            body: buffer
        });

        console.log(`3. Response Status: ${res.status} ${res.statusText}`);

        if (!res.ok) {
            const text = await res.text();
            console.error("❌ ERROR BODY:", text);
        } else {
            const json = await res.json();
            console.log("✅ SUCCESS! Inputs found:");
            // Log the inputs to prove it worked
            const inputs = json.inputs || json.inputNames;
            console.log(JSON.stringify(inputs, null, 2));
        }

    } catch (err) {
        console.error("💥 CRITICAL FAILURE:", err);
    }
}

runDebug();