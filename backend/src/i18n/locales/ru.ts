// Russian locale. Keys must stay in sync with ua.ts and en.ts.

export default {
  notifications: {
    orderCreated: {
      title: "Новый заказ",
      body: "Покупатель создал заказ. После оплаты он появится в работе."
    },
    orderPaidSeller: {
      title: "Заказ оплачен",
      body: "Покупатель оплатил заказ. Можно начинать выполнение."
    },
    orderPaidBuyer: {
      title: "Оплата в escrow",
      body: "Средства зарезервированы до подтверждения доставки."
    },
    orderStarted: {
      title: "Заказ взят в работу",
      body: "Продавец начал выполнение заказа."
    },
    orderDelivered: {
      title: "Заказ доставлен",
      body: "Проверьте результат и подтвердите доставку, если все хорошо."
    },
    orderCompleted: {
      title: "Сделка завершена",
      body: "Покупатель подтвердил доставку. Средства выплачены продавцу."
    },
    orderAutoReleased: {
      title: "Сделка завершена автоматически",
      body: "Срок подтверждения истек. Средства выплачены продавцу."
    },
    reviewCreated: {
      title: "Новый отзыв",
      body: "Покупатель оставил оценку {rating}/5."
    },
    orderDisputed: {
      title: "Открыт спор",
      body: "По заказу открыт спор. Администратор проверит историю сделки."
    },
    disputeResolved: {
      title: "Спор решен",
      bodyRefund: "Администратор решил спор в пользу возврата.",
      bodyRelease: "Администратор решил спор в пользу выплаты продавцу."
    },
    accountWarned: {
      title: "Предупреждение от модератора",
      body: "{reason}"
    },
    accountMuted: {
      title: "Временное ограничение на сообщения",
      body: "Вы не можете отправлять сообщения до {until}."
    },
    newMessage: {
      title: "Новое сообщение",
      body: "{sender}: {preview}"
    },
    newMessageDirect: {
      title: "Новое сообщение",
      body: "{sender} написал вам сообщение: {preview}"
    },
    newMessageProduct: {
      title: "Сообщение по объявлению",
      body: "{sender} написал по объявлению: {productTitle}"
    },
    newMessageOrder: {
      title: "Сообщение по заказу",
      body: "{sender} написал по заказу #{orderId}"
    },
    reconciliationMismatch: {
      title: "Расхождение в сверке баланса",
      body: "Обнаружено расхождение в ledger/wallet: {summary}. Проверьте /admin/finance."
    },
    payoutRequested: {
      title: "Запрос на выплату создан",
      body: "Ваш запрос на вывод {amount} {currency} отправлен на проверку."
    },
    payoutApproved: {
      title: "Выплата завершена",
      body: "Ваш вывод {amount} {currency} отправлен."
    },
    payoutRejected: {
      title: "Выплата отклонена",
      body: "Ваш вывод {amount} {currency} отклонен: {reason}. Средства возвращены на баланс."
    },
    payoutPendingAdmin: {
      title: "Выплата ожидает проверки",
      body: "Новый запрос на вывод {amount} {currency} требует проверки."
    },
    reportSubmitted: {
      title: "Отправлена новая жалоба",
      body: "Пользователь отправил жалобу ({reason})."
    },
    disputeNewAdmin: {
      title: "Открыт новый спор",
      body: "Открыт спор, который требует проверки администратора."
    },
    manualPaymentPendingAdmin: {
      title: "Ожидается ручной банковский перевод",
      body: "Покупатель запросил реквизиты для перевода {amount} {currency}. Подтвердите после поступления средств."
    },
    passwordChanged: {
      title: "Пароль изменен",
      body: "Пароль вашего аккаунта был изменен. Если это были не вы, немедленно обратитесь в поддержку."
    },
    emailChanged: {
      title: "Email изменен",
      body: "Email вашего аккаунта изменен на {newEmail}. Если это были не вы, немедленно обратитесь в поддержку."
    },
    twoFactorEnabled: {
      title: "Двухфакторная аутентификация включена",
      body: "Теперь для входа в аккаунт требуется код 2FA."
    },
    twoFactorDisabled: {
      title: "Двухфакторная аутентификация отключена",
      body: "2FA для вашего аккаунта отключена. Если это были не вы, немедленно обратитесь в поддержку."
    },
    telegramConnected: {
      title: "Telegram подключен",
      body: "Ваш аккаунт Telegram теперь привязан для уведомлений."
    },
    telegramDisconnected: {
      title: "Telegram отключен",
      body: "Ваш аккаунт Telegram отвязан. Вы больше не будете получать уведомления там."
    }
  },
  orderEvents: {
    created: { title: "Заказ создан", body: "Покупатель оформил заказ. Следующий шаг — оплата." },
    paid: { title: "Заказ оплачен", body: "Оплата зарезервирована в escrow." },
    started: { title: "Продавец начал выполнение", body: "Заказ принят в работу." },
    delivered: { title: "Результат передан", body: "Продавец отметил заказ доставленным и добавил данные доставки." },
    completed: { title: "Покупатель подтвердил доставку", body: "Сделка завершена, средства выплачены продавцу." },
    autoReleased: { title: "Автозавершение сделки", body: "Срок подтверждения истек, средства выплачены продавцу." },
    reviewCreated: { title: "Покупатель оставил отзыв", body: "Оценка: {rating}/5." },
    disputed: { title: "Открыт спор" },
    disputeResolved: { title: "Спор решен администратором" },
    paymentFailed: { title: "Оплата не прошла", body: "Тестовый платеж завершился ошибкой." }
  },
  payments: {
    topupDescription: "SKRYNIA: пополнение баланса"
  },
  system: {
    orderCreated: "Заказ создан. Следующий шаг — оплата.",
    paymentReceived: "Оплата получена и зарезервирована в escrow.",
    sellerStarted: "Продавец начал выполнение заказа.",
    deliverySent: "Продавец передал результат заказа. Проверьте и подтвердите доставку.",
    escrowReleased: "Покупатель подтвердил доставку. Средства выплачены продавцу.",
    disputeOpened: "Открыт спор: {reason}",
    disputeResolved: "Спор решен администратором: {note}",
    refunded: "Средства возвращены покупателю.",
    fundsReleased: "Средства выплачены продавцу."
  },
  email: {
    notification: {
      subject: "Уведомление SKRYNIA",
      cta: "Открыть SKRYNIA",
      footer: "Вы получили это письмо, потому что включены уведомления на email в настройках аккаунта."
    },
    verify: {
      subject: "Подтвердите email на SKRYNIA",
      title: "Подтвердите email",
      body: "Осталось подтвердить адрес почты, чтобы покупать, продавать и переписываться с продавцами на SKRYNIA. Ссылка действует 24 часа.",
      cta: "Подтвердить email",
      footer: "Если вы не регистрировались на SKRYNIA, просто игнорируйте это письмо.",
      text: "Подтвердите email по ссылке: {link}"
    },
    passwordReset: {
      subject: "Сброс пароля на SKRYNIA",
      title: "Сброс пароля",
      body: "Запрошен сброс пароля для вашего аккаунта на SKRYNIA. Ссылка действует 1 час.",
      cta: "Сбросить пароль",
      footer: "Если вы не запрашивали сброс пароля, просто игнорируйте это письмо — пароль останется прежним.",
      text: "Сбросьте пароль по ссылке: {link}"
    }
  },
  telegram: {
    connectedGreeting: "✅ Telegram подключен к вашему аккаунту SKRYNIA. Теперь вы будете получать уведомления здесь.",
    orderCreated: { title: "Новый заказ", body: "Покупатель создал заказ «{productTitle}»." },
    newMessage: { title: "Новое сообщение", body: "{sender}: {preview}" },
    newMessageDirect: { title: "Новое сообщение", body: "{sender} написал вам сообщение: {preview}" },
    newMessageProduct: { title: "Сообщение по объявлению", body: "{sender} написал по объявлению: {productTitle}" },
    newMessageOrder: { title: "Сообщение по заказу", body: "{sender} написал по заказу #{orderId}" },
    orderLabel: "Заказ",
    statusLabel: "Статус",
    help: "Команды бота SKRYNIA:\n/start [token] — привязать этот чат к аккаунту\n/settings — открыть настройки уведомлений\n/help — показать это сообщение",
    settingsPrompt: "Управляйте каналами уведомлений и подключением Telegram в настройках аккаунта.",
    alreadyConnected: "Этот чат уже подключен к аккаунту SKRYNIA.",
    invalidToken: "Эта ссылка для подключения недействительна или устарела. Получите новую в настройках аккаунта.",
    buttons: {
      openOrder: "Открыть заказ",
      openChat: "Открыть чат",
      openDispute: "Открыть спор",
      openWallet: "Открыть кошелек",
      openAdminPanel: "Открыть админ-панель",
      settings: "Настройки уведомлений"
    }
  }
} as const;
