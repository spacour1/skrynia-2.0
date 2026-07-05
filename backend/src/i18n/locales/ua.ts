// Ukrainian (default locale). Keys must stay in sync with ru.ts and en.ts —
// t.ts logs a warning at startup when the locales diverge.

export default {
  notifications: {
    orderCreated: {
      title: "Нове замовлення",
      body: "Покупець створив замовлення. Після оплати воно зʼявиться в роботі."
    },
    orderPaidSeller: {
      title: "Замовлення оплачено",
      body: "Покупець оплатив замовлення. Можна починати виконання."
    },
    orderPaidBuyer: {
      title: "Оплата в escrow",
      body: "Кошти зарезервовано до підтвердження доставки."
    },
    orderStarted: {
      title: "Замовлення взято в роботу",
      body: "Продавець почав виконання замовлення."
    },
    orderDelivered: {
      title: "Замовлення доставлено",
      body: "Перевірте результат і підтвердьте доставку, якщо все добре."
    },
    orderCompleted: {
      title: "Угоду завершено",
      body: "Покупець підтвердив доставку. Кошти виплачено продавцю."
    },
    orderAutoReleased: {
      title: "Угоду завершено автоматично",
      body: "Термін підтвердження минув. Кошти виплачено продавцю."
    },
    reviewCreated: {
      title: "Новий відгук",
      body: "Покупець залишив оцінку {rating}/5."
    },
    orderDisputed: {
      title: "Відкрито спір",
      body: "За замовленням відкрито спір. Адміністратор перевірить історію угоди."
    },
    disputeResolved: {
      title: "Спір вирішено",
      bodyRefund: "Адміністратор вирішив спір на користь повернення.",
      bodyRelease: "Адміністратор вирішив спір на користь виплати продавцю."
    },
    accountWarned: {
      title: "Попередження від модератора",
      body: "{reason}"
    },
    accountMuted: {
      title: "Тимчасове обмеження на повідомлення",
      body: "Ви не можете надсилати повідомлення до {until}."
    },
    newMessage: {
      title: "Нове повідомлення",
      body: "{sender}: {preview}"
    },
    newMessageDirect: {
      title: "Нове повідомлення",
      body: "{sender} написав вам повідомлення: {preview}"
    },
    newMessageProduct: {
      title: "Повідомлення по оголошенню",
      body: "{sender} написав по оголошенню: {productTitle}"
    },
    newMessageOrder: {
      title: "Повідомлення по замовленню",
      body: "{sender} написав по замовленню #{orderId}"
    },
    reconciliationMismatch: {
      title: "Розбіжність у звірці балансу",
      body: "Виявлено розбіжність у ledger/wallet: {summary}. Перевірте /admin/finance."
    }
  },
  orderEvents: {
    created: { title: "Замовлення створено", body: "Покупець оформив замовлення. Наступний крок — оплата." },
    paid: { title: "Замовлення оплачено", body: "Оплату зарезервовано в escrow." },
    started: { title: "Продавець почав виконання", body: "Замовлення прийнято в роботу." },
    delivered: { title: "Результат передано", body: "Продавець позначив замовлення доставленим і додав дані доставки." },
    completed: { title: "Покупець підтвердив доставку", body: "Угоду завершено, кошти виплачено продавцю." },
    autoReleased: { title: "Автозавершення угоди", body: "Термін підтвердження минув, кошти виплачено продавцю." },
    reviewCreated: { title: "Покупець залишив відгук", body: "Оцінка: {rating}/5." },
    disputed: { title: "Відкрито спір" },
    disputeResolved: { title: "Спір вирішено адміністратором" },
    paymentFailed: { title: "Оплата не пройшла", body: "Тестовий платіж завершився помилкою." }
  },
  payments: {
    topupDescription: "SKRYNIA: поповнення балансу"
  },
  system: {
    orderCreated: "Замовлення створено. Наступний крок — оплата.",
    paymentReceived: "Оплату отримано і зарезервовано в escrow.",
    sellerStarted: "Продавець почав виконання замовлення.",
    deliverySent: "Продавець передав результат замовлення. Перевірте і підтвердьте доставку.",
    escrowReleased: "Покупець підтвердив доставку. Кошти виплачено продавцю.",
    disputeOpened: "Відкрито спір: {reason}",
    disputeResolved: "Спір вирішено адміністратором: {note}",
    refunded: "Кошти повернено покупцю.",
    fundsReleased: "Кошти виплачено продавцю."
  },
  email: {
    notification: {
      subject: "Сповіщення SKRYNIA",
      cta: "Відкрити SKRYNIA",
      footer: "Ви отримали цей лист, тому що увімкнені сповіщення на email у налаштуваннях акаунта."
    },
    verify: {
      subject: "Підтвердьте email на SKRYNIA",
      title: "Підтвердьте email",
      body: "Залишилося підтвердити адресу пошти, щоб купувати, продавати і переписуватися з продавцями на SKRYNIA. Посилання діє 24 години.",
      cta: "Підтвердити email",
      footer: "Якщо ви не реєструвалися на SKRYNIA, просто проігноруйте цей лист.",
      text: "Підтвердьте email за посиланням: {link}"
    },
    passwordReset: {
      subject: "Скидання пароля на SKRYNIA",
      title: "Скидання пароля",
      body: "Запитано скидання пароля для вашого акаунта на SKRYNIA. Посилання діє 1 годину.",
      cta: "Скинути пароль",
      footer: "Якщо ви не запитували скидання пароля, просто проігноруйте цей лист — пароль залишиться незмінним.",
      text: "Скиньте пароль за посиланням: {link}"
    }
  },
  telegram: {
    connectedGreeting: "✅ Telegram підключено до вашого акаунта SKRYNIA. Тепер ви отримуватимете сповіщення тут.",
    orderCreated: { title: "Нове замовлення", body: "Покупець створив замовлення «{productTitle}»." },
    newMessage: { title: "Нове повідомлення", body: "{sender}: {preview}" },
    newMessageDirect: { title: "Нове повідомлення", body: "{sender} написав вам повідомлення: {preview}" },
    newMessageProduct: { title: "Повідомлення по оголошенню", body: "{sender} написав по оголошенню: {productTitle}" },
    newMessageOrder: { title: "Повідомлення по замовленню", body: "{sender} написав по замовленню #{orderId}" }
  }
} as const;
