const http = require('http');

http.get('http://localhost:5173/src/App.tsx', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`CONTENT-TYPE: ${res.headers['content-type']}`);
        if (res.statusCode === 500) {
            console.log("Found 500 error! Extracting error message...");
            // Vite error overlay usually contains the error in a <script> or text
            // Let's print the first 2000 chars of the data
            console.log(data.substring(0, 2000));
        } else {
            console.log("App.tsx loaded fine.");
        }
    });
}).on('error', (err) => {
    console.log("Error:", err.message);
});
