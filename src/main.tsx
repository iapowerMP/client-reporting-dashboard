import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ReportConfigProvider } from './lib/reportConfig'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ReportConfigProvider>
        <App />
      </ReportConfigProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
