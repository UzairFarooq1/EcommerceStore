import prisma from "@/app/lib/db";
import { redis } from "@/app/lib/redis";
import { stripe } from "@/app/lib/stripe";
import { headers } from "next/headers";
import { Stripe } from "stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("Stripe-Signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_SECRET_WEBHOOK as string
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      if (typeof session.amount_total !== 'number' || typeof session.metadata?.userId !== 'string') {
        console.error('Invalid session data:', session);
        return new Response("Invalid session data", { status: 400 });
      }

      try {
        await prisma.order.create({
          data: {
            amount: session.amount_total,
            status: session.status,
            userId: session.metadata.userId,
          },
        });

        await redis.del(`cart-${session.metadata.userId}`);
      } catch (error) {
        console.error('Error processing checkout session:', error);
        return new Response("Error processing checkout session", { status: 500 });
      }
      break;
    }
    default: {
      console.log(`Unhandled event type: ${event.type}`);
    }
  }

  return new Response(null, { status: 200 });
}