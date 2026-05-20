const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const pngPath = path.join(__dirname, 'public', 'icon.png');
const icoPath = path.join(__dirname, 'public', 'icon.ico');

console.log('Reading image and converting black background to transparent...');

Jimp.read(pngPath)
    .then(image => {
        // Remove black background with smooth feathering
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
            const r = this.bitmap.data[idx + 0];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];
            
            // Calculate luminance of the pixel
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            
            if (luminance < 20) {
                // Background pixels (very dark) -> fully transparent
                this.bitmap.data[idx + 3] = 0;
            } else if (luminance < 50) {
                // Feathered boundary pixels -> partial transparency
                const factor = (luminance - 20) / (50 - 20);
                this.bitmap.data[idx + 3] = Math.floor(factor * 255);
            }
        });
        
        // Save the transparent PNG
        return image.write(pngPath);
    })
    .then(() => {
        console.log('Transparent PNG generated successfully. Converting to ICO...');
        return import('png-to-ico');
    })
    .then(module => {
        const pngToIco = module.default;
        return pngToIco(pngPath);
    })
    .then(buf => {
        fs.writeFileSync(icoPath, buf);
        console.log('Transparent Icon successfully compiled to ICO format at:', icoPath);
    })
    .catch(err => {
        console.error('Error processing transparent icon:', err);
        process.exit(1);
    });
