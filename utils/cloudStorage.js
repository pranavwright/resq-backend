import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";
import sharp from "sharp"; 

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const storage = new Storage({
  keyFilename: path.join(__dirname, "../service-account.json"),
});


const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}



export const uploadProfileImage = async (fileData, fileName) => {
  let tempFilePath = null;
  
  try {
    const bucket = storage.bucket("resq_user_images");
    tempFilePath = path.join(tempDir, fileName);

    const imageBuffer = Buffer.from(fileData, "base64");
    
    fs.writeFileSync(tempFilePath, imageBuffer);
    
    let resizedImageBuffer;
    try {
      resizedImageBuffer = await sharp(tempFilePath)
        .resize(600, 800, {
          fit: sharp.fit.cover,
          position: 'center'
        })
        .toBuffer();
    } catch (sharpError) {
      console.error("Sharp processing error:", sharpError);
      resizedImageBuffer = imageBuffer;
    }

    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: {
        contentType: `image/${path.extname(fileName).substring(1)}`,
      },
    });

    return new Promise((resolve, reject) => {
      blobStream.on("finish", () => {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        
        const publicUrl = `https://storage.cloud.google.com/${bucket.name}/${fileName}`;
        resolve({
          success: true,
          url: publicUrl,
          message: "Image uploaded successfully"
        });
      });

      blobStream.on("error", (err) => {
        console.error("Upload error:", err);
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        reject({
          success: false,
          message: "Failed to upload image"
        });
      });

      blobStream.end(resizedImageBuffer);
    });
  } catch (error) {
    console.error("General error in uploadProfileImage:", error);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    throw error;
  }
};

export const uploadApkFile = async (file, fileName) => {
  try {
    const bucket = storage.bucket("resq_apk_files");
    const tempFilePath = path.join(__dirname, "temp", fileName);

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFilePath);
      file.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: {
        contentType: "application/vnd.android.package-archive",
      },
    });

    return new Promise((resolve, reject) => {
      blobStream.on("finish", () => {
        fs.unlinkSync(tempFilePath); 
        resolve({
          success: true,
          message: "APK uploaded successfully",
          url: `https://storage.googleapis.com/${bucket.name}/${fileName}`, 
        });
      });

      blobStream.on("error", (err) => {
        console.error(err);
        reject({
          success: false,
          message: "Failed to upload APK",
        });
      });

      blobStream.end(); 
    });
  } catch (error) {
    console.error(error);
    throw new Error("An error occurred while uploading the APK.");
  }
};
