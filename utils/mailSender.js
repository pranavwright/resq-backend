import nodemailer from "nodemailer";
import fs from "fs";
import handlebars from "handlebars";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmail = async (to, subject, templatePath, data) => {
  try {
    const template = fs.readFileSync(
      path.join(__dirname, templatePath),
      "utf8"
    );
    const html = handlebars.compile(template)(data);
    const mailOptions = {
      from: process.env.EMAIL,
      to,
      subject,
      html,
    };
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to} with subject "${subject}"`);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

export default {
  sendDonationRequestMail: async (email, donation) => {
    const subject = `Donation Request ${donation.donarName || "Anonymous"}`;
    const templatePath = "../template/email/donationRequest.hbs";
    const data = {
      name: donation.donarName || "Anonymous",
      items: donation.items,
      donatedAt: new Date(donation.createdAt).toISOString(),
    };
    return sendEmail(email, subject, templatePath, data);
  },

  sendDonationConfomationMail: async (email, donation) => {
    const subject = `Donation Confirmation ${
      donation.donarName || "Anonymous"
    }`;
    const templatePath = "../template/email/donationConfirmation.hbs";
    const data = {
      name: donation.donarName || "Anonymous",
      items: donation.items,
      donatedAt: new Date(donation.estimate).toISOString(),
    };
    return sendEmail(email, subject, templatePath, data);
  },

  sendDonationDispatchMail: async (email, donation) => {
    const subject = `Donation Dispatch ${donation.donarName || "Anonymous"}`;
    const templatePath = "../template/email/donationDispatch.hbs";
    const data = {
      name: donation.donarName || "Anonymous",
      items: donation.items,
      donatedAt: new Date(donation.deleverdAt).toISOString(),
    };
    return sendEmail(email, subject, templatePath, data);
  },
};
