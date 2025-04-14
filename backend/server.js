require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000', // Update to your frontend URL in production
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Atlas Connection
const mongoUri = process.env.MONGO_URI || 'mongodb+srv://<username>:<password>@cluster0.<random>.mongodb.net/serenity-hub?retryWrites=true&w=majority';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB Atlas connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

// Wellbeing Goal Schema
const goalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // Format: YYYY-MM-DD
  sleepHours: { type: Number, default: 0 },
  calories: { type: Number, default: 0 },
  exerciseMinutes: { type: Number, default: 0 },
  journalNotes: { type: String, default: '' },
});
const Goal = mongoose.model('Goal', goalSchema);

// Story Schema
const storySchema = new mongoose.Schema({
  name: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Story = mongoose.model('Story', storySchema);

// Doctor Schema
const doctorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  contact: { type: String, required: true },
  conditions: [{ type: String }], // e.g., ['Anxiety', 'Depression']
});
const Doctor = mongoose.model('Doctor', doctorSchema);

// Routes
// Sign Up
app.post('/api/signup', async (req, res) => {
  const { fullName, email, password } = req.body;
  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ fullName, email, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User created successfully', userId: user._id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    res.json({ message: 'Login successful', userId: user._id });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Save Wellbeing Goals/Progress
app.post('/api/goals', async (req, res) => {
  const { userId, date, sleepHours, calories, exerciseMinutes, journalNotes } = req.body;
  try {
    if (!userId || !date) {
      return res.status(400).json({ message: 'User ID and date are required' });
    }
    let goal = await Goal.findOne({ userId, date });
    if (goal) {
      goal.sleepHours = sleepHours !== undefined ? sleepHours : goal.sleepHours;
      goal.calories = calories !== undefined ? calories : goal.calories;
      goal.exerciseMinutes = exerciseMinutes !== undefined ? exerciseMinutes : goal.exerciseMinutes;
      goal.journalNotes = journalNotes !== undefined ? journalNotes : goal.journalNotes;
      await goal.save();
    } else {
      goal = new Goal({ userId, date, sleepHours, calories, exerciseMinutes, journalNotes });
      await goal.save();
    }
    res.json({ message: 'Goal saved successfully', goal });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get Wellbeing Goals
app.get('/api/goals/:userId/:date', async (req, res) => {
  const { userId, date } = req.params;
  try {
    const goal = await Goal.findOne({ userId, date });
    res.json(goal || {});
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Save Story
app.post('/api/stories', async (req, res) => {
  const { name, content } = req.body;
  try {
    if (!name || !content) {
      return res.status(400).json({ message: 'Name and content are required' });
    }
    const story = new Story({ name, content });
    await story.save();
    io.emit('newStory', story); // Broadcast to all clients
    res.status(201).json({ message: 'Story saved successfully', story });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get All Stories
app.get('/api/stories', async (req, res) => {
  try {
    const stories = await Story.find().sort({ createdAt: -1 }).limit(50);
    res.json(stories);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get Doctors
app.get('/api/doctors', async (req, res) => {
  const { condition } = req.query;
  try {
    const query = condition ? { conditions: condition } : {};
    const doctors = await Doctor.find(query);
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Seed Doctors (Run once to populate)
app.post('/api/doctors/seed', async (req, res) => {
  try {
    const sampleDoctors = [
      {
        name: 'Dr. Jane Smith',
        title: 'Psychologist',
        description: 'Specializes in anxiety and depression.',
        contact: 'jane.smith@example.com',
        conditions: ['Anxiety', 'Depression'],
      },
      {
        name: 'Dr. John Doe',
        title: 'Psychiatrist',
        description: 'Expert in PTSD and ADHD.',
        contact: 'john.doe@example.com',
        conditions: ['PTSD', 'ADHD'],
      },
      {
        name: 'Dr. Emily Brown',
        title: 'Therapist',
        description: 'Focuses on youth mental health and depression.',
        contact: 'emily.brown@example.com',
        conditions: ['Depression', 'Youth Mental Health'],
      },
      {
        name: 'Dr. Michael Lee',
        title: 'Counselor',
        description: 'Experienced with anxiety and stress management.',
        contact: 'michael.lee@example.com',
        conditions: ['Anxiety'],
      },
    ];
    await Doctor.deleteMany({});
    await Doctor.insertMany(sampleDoctors);
    res.json({ message: 'Doctors seeded successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Socket.IO for Real-Time Stories
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});