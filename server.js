const express = require("express");
const cors = require("cors");
const { db, bot } = require("./bot.js");
const readingMocks = require("./readingMocks.json");
require("dotenv").config

const app = express();
app.use(express.json())
app.use(cors())

app.post("/login", async (req, res) => {
    const { login, password } = req.body;

    try {
        const result = await db.query(
            'SELECT * FROM users WHERE login = $1 AND password = $2',
            [login, password]
        );

        if (result.rows.length > 0) {
            res.status(200).json(result.rows[0]);  // Faqat bitta user
        } else {
            res.status(400).json({ message: "Login or password incorrect or not registered" });
        }
    } catch (error) {
        console.error("Error in /login:", error);
        res.status(500).json({ message: "Error in server" });
    }
});

app.get("/get-user/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
        res.json(user.rows[0]);
    } catch (error) {
        console.error("Error in /get-user:", error);
        res.status(500).json({ message: "Error in server" });
    }
})

app.get("/reading-mocks", (req, res) => {
    res.json(readingMocks);
})

app.get("/reading-mock", (req, res) => {
    const randomIndex = Math.floor(Math.random() * readingMocks.length);
    const mock = readingMocks[randomIndex];
    res.json(mock);
});


app.post("/result", async (req, res) => {
  const { userId, mockId, answers } = req.body;
  if (!userId || !mockId || !answers) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const mock = readingMocks.find(m => m.id === mockId);
  if (!mock) {
    return res.status(404).json({ message: "Mock not found" });
  }

  try {
    // Hisoblash
    const scores = {
      p1: mock.part1.answers.reduce((acc, ans, i) => {
        return acc + ((answers.part1[i] || "").trim().toLowerCase() === ans.trim().toLowerCase());
      }, 0),
      p2: mock.part2.answers.reduce((acc, ans, i) => {
        return acc + ((answers.part2[i] || "").trim().toUpperCase() === ans.trim().toUpperCase());
      }, 0),
      p3: mock.part3.answers.reduce((acc, ans, i) => {
        return acc + ((answers.part3[i] || "").trim() === ans.trim());
      }, 0),
      p4: mock.part4.answers.reduce((acc, ans, i) => {
        return acc + ((answers.part4[i] || "").trim() === ans.trim());
      }, 0),
      p5: (() => {
        const sum = mock.part5.summary.answers.reduce((a, ans, i) => {
          return a + ((answers.part5.summary[i] || "").trim().toLowerCase() === ans.trim().toLowerCase());
        }, 0);
        return mock.part5.mc.answers.reduce((a, ans, i) => {
          return a + ((answers.part5.mc[i] || "").trim() === ans.trim());
        }, sum);
      })()
    };

    const total = scores.p1 + scores.p2 + scores.p3 + scores.p4 + scores.p5;

    const resultJson = {
      mock_id: mockId,
      date: new Date(),
      answers,
      scores,
      total
    };

    // Avvaldan bor-yo‘qligini tekshirish faqat `user_id` asosida
    const existing = await db.query("SELECT * FROM results WHERE user_id = $1", [userId]);

    let dbResult;
    if (existing.rows.length > 0) {
      const { rows } = await db.query(
        "UPDATE results SET result = $1 WHERE user_id = $2 RETURNING *",
        [resultJson, userId]
      );
      dbResult = rows[0];
    } else {
      const { rows } = await db.query(
        "INSERT INTO results (user_id, result) VALUES ($1, $2) RETURNING *",
        [userId, resultJson]
      );
      dbResult = rows[0];
    }

    res.status(200).json({ message: "Result saved", data: dbResult });
  } catch (error) {
    console.error("Error in /result:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


//   API of result:
// {
// "part1":  ["challenging", "rewarding", "enthusiasm", "motivated", "difference", "listening"]
// "part2": ["E", "C", "F", "D", "H"]
// "part3": [ "The origins of the name", "Domesticating the bee", "The hierarchy of the bee colony", "The importance to farming worldwide", "The distribution and habitat of bees", "Usefulness in research"]
// "part4":["B","A","B","D","C","A) True","A) True","C) Not Given","A) True"]
// "part5":{
// "summary": ["naringin","poisonous","Stephen Wooding","taste buds"],"mc": ["A. offset bitter flavour in food","D. transmitting bitter signals to the brain"]}
// } 

app.post("/get-result", async (req, res) => {
    const { userId } = req.body;
    try {
        const result = await db.query("SELECT * FROM results WHERE user_id = $1", [userId]);
        if (result.rows.length) {
            res.json(result.rows[0])
        } else {
            res.status(404).json({ message: "Result not found" });
        }
    } catch (error) {
        console.error("Error in /get-result:", error);
        res.status(500).json({ message: "Internal server error" });
    }
})

app.listen(process.env.PORT || 4000, () => console.log("Server is running on port: 4000"))
