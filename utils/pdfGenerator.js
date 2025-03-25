import fs from "fs";
import puppeteer from "puppeteer";
import handlebars from "handlebars";
import path from "path";
import { PDFDocument } from "pdf-lib";


import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate a PDF buffer from HTML using Puppeteer and Handlebars.
 * @param {string} html - HTML template as a string.
 * @param {Object} data - Data to inject into HTML.
 * @returns {Buffer} - Generated PDF buffer.
 */

async function generatePdfFromHtml(html, data, type) {
  const template = handlebars.compile(html);
  const compiledHtml = template(data);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(compiledHtml, { waitUntil: "networkidle0" });
  let pdfBuffer;

  if (type) {
    pdfBuffer = await page.pdf({ format: page });
  } else {
    pdfBuffer = await page.pdf({
      width: "54mm",
      height: "85mm",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
  }

  await browser.close();
  return pdfBuffer;
}

async function idCard(data, disaster) {
  const idCardTemplateFront = fs.readFileSync(
    path.join(__dirname, "../template/idCard/idCardFront.hbs"),
    "utf8"
  );
  const idCardTemplateBack = fs.readFileSync(
    path.join(__dirname, "../template/idCard/idCardBack.hbs"),
    "utf8"
  );

  const pdfBuffers = [];
  for (const user of data) {
    const userData = {
      name: user.name,
      designation:
        user.roles
          .find((role) => role.disasterId === disaster._id)
          ?.roles.join(", ") || "N/A",
      email: user.emailId || "N/A",
      phone: user.phoneNumber || "N/A",
      image_url:
        user.photoUrl ||
        "https://storage.googleapis.com/resq_user_images/logo.jpg",
      disaster: disaster.name,
      qr_data: JSON.stringify({
        name: user.name,
        designation:
          user.roles
            .find((role) => role.disasterId === disaster._id)
            ?.roles.join(", ") || "N/A",
        email: user.emailId || "N/A",
        phone: user.phoneNumber || "N/A",
        disasterId: disaster._id,
      }),
    };

    const frontPdfBuffer = await generatePdfFromHtml(
      idCardTemplateFront,
      userData,
      false
    );
    const backPdfBuffer = await generatePdfFromHtml(
      idCardTemplateBack,
      userData,
      false
    );

    pdfBuffers.push({ front: frontPdfBuffer, back: backPdfBuffer });
  }

  if (pdfBuffers.length > 0) {
    const mergedPdf = await PDFDocument.create();
  
    for (const { front, back } of pdfBuffers) {
      const frontPdf = await PDFDocument.load(front);
      const backPdf = await PDFDocument.load(back);
  
      const [frontPage] = await mergedPdf.copyPages(frontPdf, [0]);
      mergedPdf.addPage(frontPage);
  
      const [backPage] = await mergedPdf.copyPages(backPdf, [0]);
      mergedPdf.addPage(backPage);
    }
  
    const finalPdfBuffer = await mergedPdf.save();
    return Buffer.from(finalPdfBuffer);
  } else {
    return Buffer.from([]);
  }
  
}

export { idCard, generatePdfFromHtml };
