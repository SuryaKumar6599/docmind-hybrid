import './style.css'
import { Rive } from '@rive-app/canvas'
import Chart from 'chart.js/auto'

// 1. Rive Integration
const riveCanvas = document.getElementById('rive-canvas');
if (riveCanvas) {
  new Rive({
    src: 'https://cdn.rive.app/animations/marty_v6.riv',
    canvas: riveCanvas,
    autoplay: true,
    stateMachines: 'State Machine 1',
    onLoad: () => {
      // Prevent blurry canvas on high DPI screens
      riveCanvas.width = 400 * window.devicePixelRatio;
      riveCanvas.height = 400 * window.devicePixelRatio;
      riveCanvas.style.width = '400px';
      riveCanvas.style.height = '400px';
    }
  });
}

// 2. Daily Progress Calculation & UI Update
const totalInput = document.getElementById('total-habits');
const completedInput = document.getElementById('completed-habits');
const progressCircle = document.querySelector('.progress-ring__circle.fg');
const percentageText = document.getElementById('daily-percentage');
const formulaD = document.getElementById('formula-d');
const formulaT = document.getElementById('formula-t');
const formulaDec = document.getElementById('formula-dec');

const radius = progressCircle.r.baseVal.value;
const circumference = radius * 2 * Math.PI;
progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
progressCircle.style.strokeDashoffset = circumference;

function updateProgress() {
  let total = parseInt(totalInput.value) || 1;
  let completed = parseInt(completedInput.value) || 0;
  
  if (completed > total) {
    completed = total;
    completedInput.value = completed;
  }
  if (completed < 0) {
    completed = 0;
    completedInput.value = completed;
  }

  const progress = completed / total;
  const percentage = Math.round(progress * 100);

  // Update UI Elements
  formulaD.textContent = completed;
  formulaT.textContent = total;
  formulaDec.textContent = progress.toFixed(2);
  percentageText.textContent = `${percentage}%`;

  // Update SVG Circle
  const offset = circumference - (progress * circumference);
  progressCircle.style.strokeDashoffset = offset;
}

// Event Listeners for Progress Calculator
totalInput.addEventListener('input', updateProgress);
completedInput.addEventListener('input', updateProgress);
updateProgress(); // Initial call

// 3. Compounding Growth Chart (Atomic Habits 1% Rule)
const ctx = document.getElementById('compound-chart').getContext('2d');

const days = Array.from({length: 365}, (_, i) => i + 1);
const growthData = days.map(day => Math.pow(1.01, day));
const flatData = days.map(day => Math.pow(0.99, day)); // 1% worse

new Chart(ctx, {
  type: 'line',
  data: {
    labels: days,
    datasets: [
      {
        label: '1% Better Every Day (1.01^t)',
        data: growthData,
        borderColor: '#00ffcc',
        backgroundColor: 'rgba(0, 255, 204, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHitRadius: 10
      },
      {
        label: '1% Worse Every Day (0.99^t)',
        data: flatData,
        borderColor: '#ff4444',
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0.4,
        pointRadius: 0,
        fill: false
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        labels: {
          color: '#c5c6c7',
          font: {
            family: "'Inter', sans-serif"
          }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(31, 40, 51, 0.9)',
        titleColor: '#fff',
        bodyColor: '#00ffcc',
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}x`;
          }
        }
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Days (Time)',
          color: '#c5c6c7'
        },
        grid: {
          color: 'rgba(255,255,255,0.05)'
        },
        ticks: { color: '#c5c6c7', maxTicksLimit: 12 }
      },
      y: {
        title: {
          display: true,
          text: 'Improvement (Progress)',
          color: '#c5c6c7'
        },
        grid: {
          color: 'rgba(255,255,255,0.05)'
        },
        ticks: { color: '#c5c6c7' }
      }
    }
  }
});
