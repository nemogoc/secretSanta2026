import dotenv from "dotenv";
dotenv.config();

import nodemailer from 'nodemailer';

// ------------------------------
// CONFIGURATION
// ------------------------------

const participants = [
  { name: "Example1", email: "example1@example.org" },
  { name: "Example2", email: "example2@example.org" },
  { name: "Example3", email: "example3@example.org" },
  { name: "Example4", email: "example4@example.org" },
  { name: "Example5", email: "example5@example.org" }
];

// Participants who participate in the first draw only.
// Change this list as needed.
const secondDrawExcludedParticipants = ["Example4", "Example5"];

const exclusions = {
  Example1: ["Example2"],
  Example2: ["Example1"]
};

// Each person gives THIS many gifts in each draw they participate in.
const giveCounts = {
  Example1: 1,
  Example2: 1,
  Example3: 1,
  Example4: 1,
  Example5: 1
};

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
      from: "Secret Santa <you@example.com>",
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
    // FIRST DRAW
    // All participants take part, using the original exclusions.

    console.log("Generating first-draw assignments...");

    const firstDrawAssignments = generateAssignments(
      participants,
      exclusions
    );

    // SECOND DRAW
    // Remove the configured participants.

    const secondDrawParticipants = participants.filter(
      person =>
        !secondDrawExcludedParticipants.includes(person.name)
    );

    // Copy the original exclusions so the first draw remains unchanged.

    const secondDrawExclusions = Object.fromEntries(
      Object.entries(exclusions).map(
        ([giver, receivers]) => [giver, [...receivers]]
      )
    );

    // Add first-draw assignments to the second-draw exclusions.
    // Anyone who received a person in the first draw cannot receive
    // that same person again from the same giver in the second draw.

    for (const [giver, receivers] of Object.entries(
      firstDrawAssignments
    )) {
      secondDrawExclusions[giver] ??= [];

      secondDrawExclusions[giver].push(...receivers);
    }

    console.log("Generating second-draw assignments...");

    const secondDrawAssignments = generateAssignments(
      secondDrawParticipants,
      secondDrawExclusions
    );

    // Both draws have succeeded.
    // Only now do we start sending emails.

    console.log("Both draws succeeded. Sending emails...");

    await sendEmails(firstDrawAssignments, secondDrawAssignments);

  } catch (err) {
    console.error(
      "❌ Secret Santa stopped. No emails were sent if assignment generation failed:",
      err
    );

    process.exitCode = 1;
  }
})();