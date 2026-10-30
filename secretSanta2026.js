import dotenv from "dotenv";
dotenv.config();

import { readFile, writeFile } from 'node:fs/promises';

import {
  participants,
  secondDrawExcludedParticipants,
  exclusions,
  giveCounts
} from './config.js';

import nodemailer from 'nodemailer';

// ------------------------------
// PREVIOUS YEAR'S ASSIGNMENTS
// ------------------------------

const previousPicksPath = new URL(
  './previousPicks.json',
  import.meta.url
);

async function loadPreviousPicks() {
  try {
    const data = await readFile(previousPicksPath, 'utf8');
    const picks = JSON.parse(data);

    console.log("Loaded previous picks from previousPicks.json");

    return picks;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(
        "No previous picks file found. Using existing exclusions only."
      );

      return {};
    }

    throw new Error(
      `Failed to load previous picks: ${err.message}`
    );
  }
}

async function saveCurrentPicks(assignments) {
  await writeFile(
    previousPicksPath,
    JSON.stringify(assignments, null, 2),
    'utf8'
  );

  console.log("Saved current assignments to previousPicks.json");
}

function mergeExclusions(...exclusionSets) {
  const merged = {};

  for (const exclusionSet of exclusionSets) {
    for (const [giver, receivers] of Object.entries(exclusionSet)) {
      merged[giver] ??= [];

      for (const receiver of receivers) {
        if (!merged[giver].includes(receiver)) {
          merged[giver].push(receiver);
        }
      }
    }
  }

  return merged;
}

// ------------------------------
// CONFIGURATION
// ------------------------------

// Email config — retain your existing SMTP credentials.
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ------------------------------
// SECRET SANTA ASSIGNMENT LOGIC
// ------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function validateGiftCounts(drawParticipants, drawGiveCounts) {
  const n = drawParticipants.length;

  if (n === 0) {
    throw new Error(
      "Cannot generate assignments for an empty participant list."
    );
  }

  const totalGiven = drawParticipants.reduce(
    (total, person) => total + (drawGiveCounts[person.name] ?? 0),
    0
  );

  if (
    drawParticipants.some(
      person =>
        !Number.isInteger(drawGiveCounts[person.name]) ||
        drawGiveCounts[person.name] < 0
    )
  ) {
    throw new Error(
      "Every participant must have a non-negative integer gift count."
    );
  }

  if (totalGiven % n !== 0) {
    throw new Error(`
Invalid gift distribution:
Total gifts given = ${totalGiven}
Number of people = ${n}
Total gifts must be divisible by the number of participants.
`);
  }

  return totalGiven / n;
}

function generateAssignments(
  drawParticipants,
  drawExclusions,
  drawGiveCounts = giveCounts,
  maxRetries = 300
) {
  const everyoneReceives = validateGiftCounts(
    drawParticipants,
    drawGiveCounts
  );

  const names = drawParticipants.map(person => person.name);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const assignments = {};
    const receiveCounts = {};

    names.forEach(name => {
      assignments[name] = [];
      receiveCounts[name] = 0;
    });

    // Create a list of giver slots.
    const givingSlots = [];

    for (const person of drawParticipants) {
      const count = drawGiveCounts[person.name];

      for (let i = 0; i < count; i++) {
        givingSlots.push(person.name);
      }
    }

    shuffle(givingSlots);

    let failed = false;

    // Assign a recipient to each giver slot.
    for (const giver of givingSlots) {
      const possibleReceivers = names.filter(receiver =>
        receiver !== giver &&
        !drawExclusions[giver]?.includes(receiver) &&
        receiveCounts[receiver] < everyoneReceives &&
        !assignments[giver].includes(receiver)
      );

      if (possibleReceivers.length === 0) {
        failed = true;
        break;
      }

      const receiver =
        possibleReceivers[
          Math.floor(Math.random() * possibleReceivers.length)
        ];

      assignments[giver].push(receiver);
      receiveCounts[receiver]++;
    }

    const valid =
      !failed &&
      Object.values(receiveCounts).every(
        count => count === everyoneReceives
      );

    if (valid) {
      console.log(`SUCCESS on attempt ${attempt + 1}`);
      return assignments;
    }
  }

  throw new Error(
    "Failed to generate valid assignments within retry limit."
  );
}

// ------------------------------
// EMAIL SENDING
// ------------------------------

async function sendEmails(firstDrawAssignments, secondDrawAssignments) {
  for (const person of participants) {
    const { name, email } = person;

    const firstDrawRecipient = firstDrawAssignments[name]?.[0];
    const secondDrawRecipient = secondDrawAssignments[name]?.[0];

    // Build the email body with clearly labeled assignments.
    let emailBody = `Hi ${name}!\n\n`;

    emailBody += `Your Secret Santa assignment:\n\n`;
    emailBody += `${firstDrawRecipient}\n`;

    // Only include Draw 2 if this person participated in it.
    if (secondDrawRecipient) {
      emailBody += `Mom's Draw: ${secondDrawRecipient}\n`;
    }

    emailBody += `\nKeep it secret! 🎁`;

    const message = {
      from: `Secret Santa <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "🎄 Your Secret Santa Assignment!",
      text: emailBody
    };

    try {
      await transporter.sendMail(message);

      console.log(`Sent email to ${name}` );
      
      //uncomment below for spoilers in console
      /*
      console.log(
        `Sent email to ${name}: Draw 1 = ${firstDrawRecipient}` +
        (secondDrawRecipient
          ? `, Draw 2 = ${secondDrawRecipient}`
          : "")
      );
      */
    } catch (err) {
      console.error(`❌ Failed to send to ${name}:`, err);
    }
  }

  console.log("Email sending finished.");
}

// ------------------------------
// MAIN
// ------------------------------

(async () => {
  try {
    // LOAD PREVIOUS YEAR'S PICKS

    const previousPicks = await loadPreviousPicks();

    // Combine the original exclusions with last year's assignments.
    // This prevents a giver from receiving the same recipient
    // in consecutive years.

    const currentExclusions = mergeExclusions(
      exclusions,
      previousPicks
    );

    // FIRST DRAW
    // All participants take part.

    console.log("Generating first-draw assignments...");

    const firstDrawAssignments = generateAssignments(
      participants,
      currentExclusions
    );

    // SECOND DRAW
    // Remove configured participants.

    const secondDrawParticipants = participants.filter(
      person =>
        !secondDrawExcludedParticipants.includes(person.name)
    );

    // Start with the original exclusions AND previous year's picks.
    // Then add this year's first-draw assignments to prevent duplicates
    // across the two draws.

    const secondDrawExclusions = mergeExclusions(
      currentExclusions,
      firstDrawAssignments
    );

    console.log("Generating second-draw assignments...");

    const secondDrawAssignments = generateAssignments(
      secondDrawParticipants,
      secondDrawExclusions
    );

    // COMBINE ASSIGNMENTS
    // Everyone gets their assignments from both draws, if applicable.

    const allAssignments = {};

    for (const person of participants) {
      const name = person.name;

      allAssignments[name] = [
        ...(firstDrawAssignments[name] ?? []),
        ...(secondDrawAssignments[name] ?? [])
      ];
    }

    // SAVE THE RESULTS
    // Both draws must succeed before the history file is updated.
    // If either draw fails, execution jumps to catch and the old
    // previousPicks.json remains unchanged.

    await saveCurrentPicks(allAssignments);

    // SEND EMAILS
    // Both draws have succeeded and the results have been saved.

    console.log("Both draws succeeded. Sending emails...");

    await sendEmails(
      firstDrawAssignments,
      secondDrawAssignments
    );

  } catch (err) {
    console.error(
      "❌ Secret Santa stopped:",
      err
    );

    process.exitCode = 1;
  }
})();
