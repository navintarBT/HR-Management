import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom';
import { appRoutes } from './App';
import './styles/sticky.css';

const router = createBrowserRouter(createRoutesFromElements(appRoutes));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
