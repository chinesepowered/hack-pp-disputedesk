/**
 * pnpm buyer <command>: play the sandbox buyer's side of a dispute, in PayPal's own pages.
 *
 *   pnpm buyer accept-offer <dispute-id>     accept the seller's offer in the Resolution Center
 *
 * The desk itself only ever acts as the seller. This is for demos and for recording Replay
 * fixtures, where someone has to answer as the buyer. Sandbox only.
 */
import "./_env";
import { acceptOffer, openBuyerSession } from "./lib/buyer";

async function main() {
  const [command, disputeId] = process.argv.slice(2);
  if (command !== "accept-offer" || !disputeId) {
    console.log("Usage: pnpm buyer accept-offer <dispute-id>");
    process.exit(1);
  }
  const session = await openBuyerSession();
  try {
    const result = await acceptOffer(session, disputeId);
    console.log(`Buyer accepted the offer on ${disputeId}: ${result}`);
    console.log("PayPal refunds the offer amount and resolves the dispute. Check the board in a minute.");
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
