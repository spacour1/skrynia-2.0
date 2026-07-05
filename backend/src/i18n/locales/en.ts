// English locale. Keys must stay in sync with ua.ts and ru.ts.

export default {
  notifications: {
    orderCreated: {
      title: "New order",
      body: "A buyer created an order. It will move to work after payment."
    },
    orderPaidSeller: {
      title: "Order paid",
      body: "The buyer paid for the order. You can start working on it."
    },
    orderPaidBuyer: {
      title: "Payment in escrow",
      body: "Funds are reserved until delivery is confirmed."
    },
    orderStarted: {
      title: "Order in progress",
      body: "The seller started working on your order."
    },
    orderDelivered: {
      title: "Order delivered",
      body: "Check the result and confirm delivery if everything is fine."
    },
    orderCompleted: {
      title: "Deal completed",
      body: "The buyer confirmed delivery. Funds were released to the seller."
    },
    orderAutoReleased: {
      title: "Deal completed automatically",
      body: "The confirmation window expired. Funds were released to the seller."
    },
    reviewCreated: {
      title: "New review",
      body: "The buyer left a {rating}/5 rating."
    },
    orderDisputed: {
      title: "Dispute opened",
      body: "A dispute was opened for the order. An admin will review the deal history."
    },
    disputeResolved: {
      title: "Dispute resolved",
      bodyRefund: "The admin resolved the dispute in favor of a refund.",
      bodyRelease: "The admin resolved the dispute in favor of the seller payout."
    },
    accountWarned: {
      title: "Moderator warning",
      body: "{reason}"
    },
    accountMuted: {
      title: "Temporary messaging restriction",
      body: "You cannot send messages until {until}."
    },
    newMessage: {
      title: "New message",
      body: "{sender}: {preview}"
    },
    newMessageDirect: {
      title: "New message",
      body: "{sender} sent you a message: {preview}"
    },
    newMessageProduct: {
      title: "Listing message",
      body: "{sender} wrote about listing: {productTitle}"
    },
    newMessageOrder: {
      title: "Order message",
      body: "{sender} wrote about order #{orderId}"
    },
    reconciliationMismatch: {
      title: "Balance reconciliation mismatch",
      body: "Ledger/wallet mismatch detected: {summary}. Check /admin/finance."
    }
  },
  orderEvents: {
    created: { title: "Order created", body: "The buyer placed an order. The next step is payment." },
    paid: { title: "Order paid", body: "The payment is reserved in escrow." },
    started: { title: "Seller started work", body: "The order is in progress." },
    delivered: { title: "Result delivered", body: "The seller marked the order delivered and added delivery details." },
    completed: { title: "Buyer confirmed delivery", body: "The deal is complete, funds were released to the seller." },
    autoReleased: { title: "Deal auto-completed", body: "The confirmation window expired, funds were released to the seller." },
    reviewCreated: { title: "Buyer left a review", body: "Rating: {rating}/5." },
    disputed: { title: "Dispute opened" },
    disputeResolved: { title: "Dispute resolved by admin" },
    paymentFailed: { title: "Payment failed", body: "The test payment finished with an error." }
  },
  payments: {
    topupDescription: "SKRYNIA: balance top up"
  },
  system: {
    orderCreated: "Order created. The next step is payment.",
    paymentReceived: "Payment received and reserved in escrow.",
    sellerStarted: "The seller started working on the order.",
    deliverySent: "The seller delivered the order result. Check it and confirm delivery.",
    escrowReleased: "The buyer confirmed delivery. Funds were released to the seller.",
    disputeOpened: "Dispute opened: {reason}",
    disputeResolved: "Dispute resolved by admin: {note}",
    refunded: "Funds were returned to the buyer.",
    fundsReleased: "Funds were released to the seller."
  },
  email: {
    notification: {
      subject: "SKRYNIA notification",
      cta: "Open SKRYNIA",
      footer: "You received this email because email notifications are enabled in your account settings."
    },
    verify: {
      subject: "Confirm your email on SKRYNIA",
      title: "Confirm your email",
      body: "Confirm your email address to buy, sell, and message sellers on SKRYNIA. The link is valid for 24 hours.",
      cta: "Confirm email",
      footer: "If you didn't sign up on SKRYNIA, just ignore this email.",
      text: "Confirm your email via this link: {link}"
    },
    passwordReset: {
      subject: "Password reset on SKRYNIA",
      title: "Password reset",
      body: "A password reset was requested for your SKRYNIA account. The link is valid for 1 hour.",
      cta: "Reset password",
      footer: "If you didn't request a password reset, just ignore this email — your password stays the same.",
      text: "Reset your password via this link: {link}"
    }
  },
  telegram: {
    connectedGreeting: "✅ Telegram is connected to your SKRYNIA account. You will now receive notifications here.",
    orderCreated: { title: "New order", body: "A buyer created an order for \"{productTitle}\"." },
    newMessage: { title: "New message", body: "{sender}: {preview}" },
    newMessageDirect: { title: "New message", body: "{sender} sent you a message: {preview}" },
    newMessageProduct: { title: "Listing message", body: "{sender} wrote about listing: {productTitle}" },
    newMessageOrder: { title: "Order message", body: "{sender} wrote about order #{orderId}" }
  }
} as const;
