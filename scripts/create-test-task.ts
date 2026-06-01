import { prisma } from "../lib/prisma";

// Only 1st degree connections — clicking Message opens compose overlay, not general inbox
const TEST_URLS = [
  "https://www.linkedin.com/in/adi-berman/",
];

const TEST_TEXT = "היי! זו הודעת בדיקה אוטומטית מהמערכת שלנו - תרגישי חופשי להתעלם 🙂";

async function main() {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: "ariel@triolla.io" },
    select: { id: true, email: true },
  });
  console.log("User:", user.email);

  for (const linkedinUrl of TEST_URLS) {
    const task = await prisma.extensionTask.create({
      data: {
        userId: user.id,
        kind: "SEND",
        payload: { linkedinUrl, text: TEST_TEXT },
        scheduledFor: new Date(Date.now() - 1000),
      },
    });
    console.log("✅ Task created:", task.id, "→", linkedinUrl);
  }

  console.log("\n⏳ Extension should pick up tasks within 30 seconds...");
}

main().finally(() => prisma.$disconnect());
