const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

app.post('/write-thought', (req, res) => {
  const newThought = req.body.thought;
  if (!newThought) return res.status(400).send("No thought provided.");

  const filePath = 'us_memory.json.txt';
  try {
    let memory = { thoughts: [] };
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      memory = JSON.parse(data);
    }

    memory.thoughts.push(newThought);
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
    return res.send({ success: true, message: "Thought added." });
  } catch (err) {
    return res.status(500).send("Error updating memory.");
  }
});

app.get('/', (req, res) => {
  res.send("Echo Memory Server is running.");
});

app.listen(3000, () => {
  console.log("Echo memory server running on port 3000.");
});
