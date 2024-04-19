import https from 'https';


export async function fetchPublicIP() {
    let publicIP;
    await new Promise((resolve, reject) => {
        https.get('https://api.ipify.org?format=json', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            publicIP = JSON.parse(data).ip;
            resolve(publicIP);
        });
        }).on('error', (error) => {
            reject(error);
        });
    });
    return publicIP;
};

export async function getPublicMultiaddr(node) {
    const publicIP = await fetchPublicIP();
    let addr = node.getMultiaddrs()[0].toString();
    let parts = addr.split('/');
    parts[2] = publicIP;
    const publicMultiaddr = parts.join('/');
    return publicMultiaddr;
}