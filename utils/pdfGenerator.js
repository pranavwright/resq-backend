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

async function idCard(datas) {
  const idCardTemplateFront = fs.readFileSync(
    "../template/idCard/idcardfront.hbs",
    "utf8"
  );
  const idCardTemplateBack = fs.readFileSync(
    "../template/idCard/idcardBack.hbs",
    "utf8"
  );

  let pdfBuffer;
  for (const user in datas) {
    pdfBuffer.push(generatePdfFromHtml(idCardTemplateFront, user));
    pdfBuffer.push(generatePdfFromHtml(idCardTemplateBack, user));
  }

  // Save to file
  fs.writeFileSync("id_card.pdf", pdfBuffer);
  console.log("PDF saved as id_card.pdf");
  return pdfBuffer;
}

export {idCard, generatePdfFromHtml}
