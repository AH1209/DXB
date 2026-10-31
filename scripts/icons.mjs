import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const folder = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
for (const [size, name] of [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
  [180, 'apple-touch-icon.png'],
  [32, 'favicon-32.png'],
])
  await sharp(join(folder, 'original.png'))
    .resize(size, size, { fit: 'contain', background: '#000' })
    .png()
    .toFile(join(folder, name));
const emblem = await sharp(join(folder, 'original.png')).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#000' } })
  .composite([{ input: emblem, left: 56, top: 56 }])
  .png()
  .toFile(join(folder, 'maskable-512.png'));
