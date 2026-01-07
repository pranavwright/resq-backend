import nodemailer from "nodemailer";
import fs from "fs";
import handlebars from "handlebars";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const user = process.env.EMAIL || "";
const pass = process.env.EMAIL_PASS || "";


const sendEmail = async (to, subject, templatePathOrHtml, data = {}) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: user,
        pass: pass,
      },
    });

    let html;
    if (templatePathOrHtml.endsWith(".hbs")) {
      const template = fs.readFileSync(
        path.resolve(__dirname, templatePathOrHtml),
        "utf8"
      );
      html = handlebars.compile(template)(data);
    } else {
      html = templatePathOrHtml; // If direct HTML string is provided
    }

    const mailOptions = {
      from: process.env.EMAIL,
      to,
      subject,
      text: subject,
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
      donatedAt: new Date().toISOString(),
    };
    return sendEmail(email, subject, templatePath, {});

  },

  sendDonationConfomationMail: async (email, donation) => {
    if (email == "") {
      return;
    }
    const subject = `Donation Confirmation ${donation?.donarName || "Anonymous"
      }`;
    const templatePath = "../template/email/donationConfirmation.hbs";

    // Construct Google Maps URL if location data exists
    let dropLocationUrl = "#";
    let address = "Contact Admin for location";

    if (donation.collectionPoint) {
      address = donation.collectionPoint.location || donation.collectionPoint.address || "Contact Admin";
      if (donation.collectionPoint.locationMap && donation.collectionPoint.locationMap.lat && donation.collectionPoint.locationMap.lng) {
        dropLocationUrl = `https://www.google.com/maps?q=${donation.collectionPoint.locationMap.lat},${donation.collectionPoint.locationMap.lng}`;
      } else if (donation.collectionPoint.geoLocation && donation.collectionPoint.geoLocation.coordinates) {
        // GeoJSON is [lng, lat]
        dropLocationUrl = `https://www.google.com/maps?q=${donation.collectionPoint.geoLocation.coordinates[1]},${donation.collectionPoint.geoLocation.coordinates[0]}`;
      }
    }

    const data = {
      name: donation?.donarName || "Anonymous",
      items: donation?.donationItems,
      donatedAt: donation.estimate == "Invalid Date" ? new Date(donation.estimate).toLocaleString() : new Date(donation.estimate).toLocaleString(), // Format date nicely
      cpName: donation.collectionPoint ? donation.collectionPoint.name : 'Assigned Center',
      address: address,
      dropLocationUrl: dropLocationUrl
    };
    return sendEmail(email, subject, templatePath, data);
  },

  sendDonationDispatchMail: async (email, donation) => {
    const subject = `Donation Dispatch ${donation.donarName || "Anonymous"}`;
    const templatePath = "../template/email/donationDispatch.hbs";
    const data = {
      name: donation.donarName || "Anonymous",
      items: donation.donationItems,
      donatedAt: new Date(donation.deleverdAt).toISOString(),
    };
    return sendEmail(email, subject, templatePath, data);
  },
};
