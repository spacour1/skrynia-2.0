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
    },
    payoutRequested: {
      title: "Payout requested",
      body: "Your withdrawal request for {amount} {currency} was submitted for review."
    },
    payoutApproved: {
      title: "Payout completed",
      body: "Your withdrawal of {amount} {currency} was sent."
    },
    payoutRejected: {
      title: "Payout rejected",
      body: "Your withdrawal of {amount} {currency} was rejected: {reason}. The funds were returned to your wallet."
    },
    payoutPendingAdmin: {
      title: "Payout pending review",
      body: "A new withdrawal request for {amount} {currency} needs review."
    },
    reportSubmitted: {
      title: "New report submitted",
      body: "A user submitted a report ({reason})."
    },
    disputeNewAdmin: {
      title: "New dispute opened",
      body: "A dispute was opened and needs admin review."
    },
    manualPaymentPendingAdmin: {
      title: "Manual bank transfer pending",
      body: "A buyer requested bank transfer details for {amount} {currency}. Confirm once the transfer arrives."
    },
    passwordChanged: {
      title: "Password changed",
      body: "Your account password was changed. If this wasn't you, contact support immediately."
    },
    emailChanged: {
      title: "Email address changed",
      body: "Your account email was changed to {newEmail}. If this wasn't you, contact support immediately."
    },
    twoFactorEnabled: {
      title: "Two-factor authentication enabled",
      body: "2FA is now required to sign in to your account."
    },
    twoFactorDisabled: {
      title: "Two-factor authentication disabled",
      body: "2FA was turned off for your account. If this wasn't you, contact support immediately."
    },
    telegramConnected: {
      title: "Telegram connected",
      body: "Your Telegram account is now linked for notifications."
    },
    telegramDisconnected: {
      title: "Telegram disconnected",
      body: "Your Telegram account was unlinked. You will no longer receive notifications there."
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
    newMessageOrder: { title: "Order message", body: "{sender} wrote about order #{orderId}" },
    orderLabel: "Order",
    statusLabel: "Status",
    help: "SKRYNIA bot commands:\n/start [token] — link this chat to your account\n/settings — open notification settings\n/help — show this message",
    settingsPrompt: "Manage your notification channels and Telegram connection in account settings.",
    alreadyConnected: "This chat is already connected to a SKRYNIA account.",
    invalidToken: "This connection link is invalid or has expired. Request a new one from your account settings.",
    buttons: {
      openOrder: "Open order",
      openChat: "Open chat",
      openDispute: "Open dispute",
      openWallet: "Open wallet",
      openAdminPanel: "Open admin panel",
      settings: "Notification settings"
    }
  }
} as const;
