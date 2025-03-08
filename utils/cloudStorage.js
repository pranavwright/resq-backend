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

export const uploadProfileImage = async (file, fileName) => {
  try {
    const bucket = storage.bucket("resq_user_images");
    const tempFilePath = path.join(__dirname, "temp", fileName);

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFilePath);
      file.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const resizedImageBuffer = await sharp(tempFilePath)
      .resize(600, 300)
      .toBuffer();

    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: {
        contentType: "image/jpeg", 
      },
    });

    return new Promise((resolve, reject) => {
      blobStream.on("finish", () => {
        fs.unlinkSync(tempFilePath); 
        resolve({
          success: true,
          message: "Image uploaded successfully",
          url: `https://storage.googleapis.com/${bucket.name}/${fileName}`,
        });
      });

      blobStream.on("error", (err) => {
        console.error(err);
        reject({
          success: false,
          message: "Failed to upload image",
        });
      });

      blobStream.end(resizedImageBuffer); 
    });
  } catch (error) {
    console.error(error);
    throw new Error("An error occurred while uploading the image.");
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
