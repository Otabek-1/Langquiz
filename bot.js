require("dotenv").config();
const fs = require("fs");
const { Telegraf, Markup, session } = require("telegraf");
const { Client } = require("pg");

const questionsData = JSON.parse(fs.readFileSync("questions.json", "utf-8"));

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const db = new Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
  ssl: { rejectUnauthorized: false }
});

db.connect().then(() => console.log("✅ PostgreSQL connected"))
  .catch(err => console.error("❌ PostgreSQL connection error:", err));

const classes = ["7A", "7B", "8A", "8B", "9A", "9B", "10A". "10B", "11A", "11B"];
const userSessions = {}; // Foydalanuvchi ID asosida sessionlar

function getRandomQuestions(count = 15) {
  const shuffled = [...questionsData].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  ctx.session ??= {};
  const { rows } = await db.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);

  if (rows.length > 0) {
    const user = rows[0];
    ctx.session.fullName = user.full_name;
    ctx.session.class = user.class;
    ctx.session.quiz = null;

    return ctx.reply(`Siz avval ro‘yxatdan o‘tgansiz: ${user.full_name} (${user.class})`,
      Markup.inlineKeyboard([[Markup.button.callback("🧪 Testni boshlash", "show_quiz_intro")]]));
  }

  ctx.reply("Salom! Iltimos, to‘liq ismingizni kiriting:");
});

// Ism olish
bot.on("text", async (ctx) => {
  if (ctx.session.fullName || ctx.message.text.startsWith("/")) return;

  ctx.session.fullName = ctx.message.text;
  await ctx.reply("Sinfingizni tanlang:", Markup.inlineKeyboard(
    classes.map((cls) => [Markup.button.callback(cls, `class_${cls}`)])
  ));
});

// Sinfni tanlash
classes.forEach((cls) => {
  bot.action(`class_${cls}`, async (ctx) => {
    const telegramId = ctx.from.id;
    ctx.session.class = cls;

    try {
      await db.query(
        "INSERT INTO users (telegram_id, full_name, class) VALUES ($1, $2, $3) ON CONFLICT (telegram_id) DO NOTHING",
        [telegramId, ctx.session.fullName, cls]
      );

      await ctx.answerCbQuery();
      await ctx.reply(
        `✅ Rahmat, ${ctx.session.fullName}! Siz ${cls} sinfidan ro‘yxatdan o‘tdingiz.`,
        Markup.inlineKeyboard([[Markup.button.callback("🧪 Testni boshlash", "show_quiz_intro")]])
      );
    } catch (err) {
      console.error(err);
      ctx.reply("❌ Xatolik yuz berdi.");
    }
  });
});

// Test intro
bot.action("show_quiz_intro", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "📋 Test haqida ma'lumot:\n\n" +
    "🧠 15 ta test savoli bo‘ladi\n" +
    "⏱ Har bir savol uchun 15 soniya vaqt\n" +
    "📊 Natija yakunda ko‘rsatiladi\n\n" +
    "Tayyormi? Quyidagi tugmani bosing 👇",
    Markup.inlineKeyboard([[Markup.button.callback("🚀 Testni boshlash", "start_quiz")]])
  );
});

// Testni boshlash
bot.action("start_quiz", async (ctx) => {
  const telegramId = ctx.from.id;
  ctx.session.quiz = {
    questions: getRandomQuestions(15),
    current: 0,
    score: 0,
    timers: {}
  };

  await ctx.answerCbQuery();
  await ctx.editMessageText("✅ Test boshlandi!");
  await sendQuestion(ctx);
});

// Savol yuborish
async function sendQuestion(ctx) {
  const quiz = ctx.session.quiz;
  if (!quiz) return;

  const { questions, current } = quiz;
  if (current >= questions.length) {
    await ctx.reply(`✅ Test tugadi!\nSizning natijangiz: ${quiz.score} / ${questions.length}`);
    await db.query("UPDATE users SET score = $1 WHERE telegram_id = $2", [quiz.score, ctx.from.id]);
    ctx.session.quiz = null;
    return;
  }

  const q = questions[current];
  const options = q.options.map((opt, idx) =>
    [Markup.button.callback(opt, `answer_${current}_${idx}`)]
  );

  await ctx.reply(`❓ ${q.question}`, Markup.inlineKeyboard(options));

  // 30 sekunddan so‘ng avtomatik keyingi savol
  const key = `${ctx.from.id}_${current}`;
  if (quiz.timers[key]) clearTimeout(quiz.timers[key]);

  quiz.timers[key] = setTimeout(() => {
    if (ctx.session.quiz && ctx.session.quiz.current === current) {
      ctx.session.quiz.current++;
      sendQuestion(ctx);
    }
  }, 15_000);
}

// Javobni qabul qilish
bot.action(/^answer_(\d+)_(\d+)$/, async (ctx) => {
  const telegramId = ctx.from.id;
  const quiz = ctx.session.quiz;
  if (!quiz) return;

  const [_, questionIndexStr, answerIndexStr] = ctx.match;
  const questionIndex = parseInt(questionIndexStr);
  const answerIndex = parseInt(answerIndexStr);

  if (quiz.current !== questionIndex) return ctx.answerCbQuery("Bu savolga allaqachon javob berilgan.");

  const currentQuestion = quiz.questions[questionIndex];
  const correct = currentQuestion.correct_option_id;

  if (answerIndex === correct) quiz.score++;

  await ctx.answerCbQuery("✅ Javob qabul qilindi!");
  quiz.current++;

  // Timer tozalansin
  const key = `${telegramId}_${questionIndex}`;
  if (quiz.timers[key]) clearTimeout(quiz.timers[key]);

  await sendQuestion(ctx);
});

bot.launch();
