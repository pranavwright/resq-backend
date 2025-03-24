const fs = require("fs");
const puppeteer = require("puppeteer");
const handlebars = require("handlebars");

/**
 * Generate a PDF buffer from HTML using Puppeteer and Handlebars.
 * @param {string} html - HTML template as a string.
 * @param {Object} data - Data to inject into HTML.
 * @returns {Buffer} - Generated PDF buffer.
 */
async function generatePdfFromHtml(html, data, type) {
  const template = handlebars.compile(html);
  const compiledHtml = template(data);

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setContent(compiledHtml, { waitUntil: "networkidle0" });
  let pdfBuffer;

  if (type) {
    pdfBuffer = await page.pdf({ format: page });
  } else {
    pdfBuffer = await page.pdf({
      width: "85mm",
      height: "54mm",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
  }

  await browser.close();
  return pdfBuffer;
}

async function idCard(data) {
  const idCardTemplateFront = fs.readFileSync(
    "../template/idCard/idcardfront.hbs",
    "utf8"
  );
  const idCardTemplateBack = fs.readFileSync(
    "../template/idCard/idcardBack.hbs",
    "utf8"
  );

  const pdfBuffers = [];
  for (const user of data) {
    const userData = {
      name: user.name,
      designation:
        user.roles
          .find((role) => role.disasterId === disasterId)
          ?.roles.join(", ") || "N/A",
      email: user.emailId || "N/A",
      phone: user.phoneNumber || "N/A",
      image_url: user.photoUrl || "https://storage.googleapis.com/resq_user_images/logo.jpg", 
      disaster: disasterId,
      qr_data: JSON.stringify({
        name: user.name,
        designation:
          user.roles
            .find((role) => role.disasterId === disasterId)
            ?.roles.join(", ") || "N/A",
        email: user.emailId || "N/A",
        phone: user.phoneNumber || "N/A",
        disasterId: disasterId,
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

  // Combine front and back PDFs into a single PDFuy5o8ynhtkuyujykyo70p (using a library like pdf-lib if needed)
  // For simplicity, we'll send the first card's front and back combined.
  if (pdfBuffers.length > 0) {
    const combinedPdf = Buffer.concat([
      pdfBuffers[0].front,
      pdfBuffers[0].back,
    ]);
    return combinedPdf;
  } else {
    return Buffer.from([]); // return empty buffer if no data
  }
}

export { idCard, generatePdfFromHtml };
