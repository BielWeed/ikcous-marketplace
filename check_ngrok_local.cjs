async function checkNgrok() {
    try {
        const response = await fetch('http://localhost:4040/api/tunnels');
        const data = await response.json();
        console.log('Ngrok Tunnels:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('❌ Ngrok não está rodando no 4040:', err.message);
    }
}
checkNgrok();
