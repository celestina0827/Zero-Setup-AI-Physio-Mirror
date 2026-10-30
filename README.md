# Zero-Setup AI Physio-Mirror

An AI-powered, browser-based physiotherapy coach designed to help rehabilitation patients perform exercises safely at home. Built with Vanilla JavaScript and Google MediaPipe, it offers real-time posture correction with zero app installation.

## 🚀 Core Features

*   **Real-Time Skeletal Tracking:** Utilizes MediaPipe Pose Landmarker to map 33 3D body landmarks directly in the browser with zero latency.
*   **Dynamic Angle Calculation:** Computes precise joint angles (e.g., elbow, knee) using inverse trigonometry (`Math.atan2`) to ensure exercises meet specific range-of-motion targets.
*   **Voice Command Integration:** Powered by the Web Speech API, allowing users to navigate exercises hands-free (e.g., say "next exercise", "harder", "hold").
*   **Smart Pain Logger & Gesture Recognition:** Patients can log pain events by saying "pain", tapping the screen, or simply raising their free hand above their head for 1 second.
*   **Automated Caregiver Reports:** Generates a printable one-page clinical summary tracking weekly active days, movement quality, and logged pain events.
*   **Adaptive Difficulty Scaling:** Automatically adjusts target angles and hold timers across three phases: Warm-up, Working, and Challenge.
*   **HCI-Optimized Dashboard:** A high-contrast, dark-mode medical UI designed to prevent cognitive overload for elderly users.

## 🛠️ Tech Stack
*   **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
*   **AI/Computer Vision:** Google MediaPipe Tasks Vision
*   **Data Storage:** Browser LocalStorage (Privacy-first, no cloud video uploading)
*   **Deployment:** Vercel

## 👨‍💻 Developed By
**CELESTINA ONG YING XUAN** - Built for DSH Hacks V2 (AI x Healthcare)
