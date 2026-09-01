export const uk = {
	app: {
		title: "Дідуни",
		unsupportedBrowser: "Для Diduny потрібен підтримуваний браузер",
		unsupportedBrowserIntro:
			"Використайте сучасний браузер на основі Chromium з такими можливостями:",
		workspace: "Робочий простір",
		nav: {
			dictation: "Диктування",
			library: "Бібліотека",
			settings: "Налаштування",
			signOut: "Вийти",
		},
	},
	auth: {
		description: "Увійдіть один раз, щоб цей браузер був доступний розширенню.",
		email: "Електронна пошта",
		oneTimeCode: "Одноразовий код",
		sendCode: "Надіслати одноразовий код",
		signIn: "Увійти",
		useAnotherEmail: "Використати іншу пошту",
	},
	status: {
		ready: "Готово до диктування.",
		signIn: "Увійдіть, щоб диктувати.",
		cancelled: "Диктування скасовано.",
		transcribing: "Розпізнавання…",
		noSpeech: "Мовлення не виявлено. Нічого не надіслано.",
		listening: "Слухаю…",
		copied: "Скопійовано до буфера обміну.",
	},
	dictation: {
		languageHints: "Мовні підказки",
		translationMode: "Диктування з перекладом",
		translates: "Перекладає з {source} на {target}.",
		document: "Документ диктування",
		documentPlaceholder:
			"Тут з’явиться диктування. Ви можете редагувати текст під час роботи.",
		start: "Почати диктування",
		stop: "Зупинити диктування",
		hold: "Утримуйте для запису",
		cancel: "Скасувати",
		copy: "Копіювати",
		microphoneLevel: "Рівень мікрофона",
		meterSending: "Надсилання",
		meterIdle: "Очікування",
		meterElapsed: "{seconds} с",
		shortcut: "Скорочення: {shortcut} поза текстовими полями.",
		pasteTitle: "Переклад вставленого тексту",
		pasteDescription:
			"Вставте текст у Diduny для перекладу. Інші програми не зчитуються.",
		textToTranslate: "Текст для перекладу",
		translatePasted: "Перекласти вставлений текст",
		translationResult: "Результат перекладу",
	},
	liveTranscript: {
		title: "Поточний текст",
		final: "Фінальний",
		provisional: "Попередній",
	},
	settings: {
		title: "Налаштування",
		interfaceLanguage: "Мова інтерфейсу",
		saveInterfaceLanguage: "Зберегти мову інтерфейсу",
		retention: {
			never: "Не зберігати",
			days7: "7 днів",
			days30: "30 днів",
			days90: "90 днів",
			year1: "1 рік",
			forever: "Зберігати назавжди",
		},
	},
	library: {
		title: "Бібліотека",
		search: "Шукати в бібліотеці",
		statusLabel: {
			failed: "Помилка",
			partiallyRecovered: "Відновлено",
			processing: "Обробляється",
			transcribed: "Розпізнано",
			translated: "Перекладено",
			unprocessed: "Не оброблено",
		},
		typeLabel: {
			voice: "Диктування",
			meeting: "Зустріч",
			meetingTranslation: "Переклад зустрічі",
			translation: "Переклад",
			fileTranscription: "Розпізнавання файлу",
		},
	},
	errors: {
		quotaExceeded:
			"У вас закінчилися години ({used} з {limit} використано). Додайте години або дочекайтеся оновлення плану, а тоді спробуйте ще раз.",
		localProcessUnavailable:
			"Локальний процес Diduny недоступний. Запустіть або перезапустіть його, а тоді спробуйте ще раз.",
		proxyUnavailable:
			"Проксі розпізнавання недоступний. Перевірте з’єднання або перезапустіть його, а тоді спробуйте ще раз.",
		authenticationFailed:
			"Термін входу в Diduny завершився. Увійдіть знову, а тоді повторіть дію.",
		realtimeUnavailable:
			"Розпізнавання в реальному часі зупинилося після повторних підключень. Перевірте локальний сервіс Diduny і спробуйте ще раз.",
		remoteAcquisitionUnavailableOnWeb:
			"Diduny для вебу не може отримувати YouTube URL. Завантажте файл самостійно та додайте його, коли з’являться пакетні завантаження файлів.",
		requestRejected:
			"Сервіс Diduny відхилив цей запит. Спробуйте ще раз; якщо проблема повторюється, перезапустіть локальний сервіс Diduny.",
	},
	statistics: {
		recordings:
			"{count, plural, one {# запис} few {# записи} many {# записів} other {# запису}}",
	},
} as const;
