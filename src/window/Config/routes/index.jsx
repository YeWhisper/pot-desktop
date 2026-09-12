import { Navigate } from 'react-router-dom';
import { lazy } from 'react';

const Translate = lazy(() => import('../pages/Translate'));
const Recognize = lazy(() => import('../pages/Recognize'));
const General = lazy(() => import('../pages/General'));
const Service = lazy(() => import('../pages/Service'));
const History = lazy(() => import('../pages/History'));
const Hotkey = lazy(() => import('../pages/Hotkey'));
const Backup = lazy(() => import('../pages/Backup'));
const About = lazy(() => import('../pages/About'));

const routes = [
    {
        path: '/general',
        element: <General />,
    },
    {
        path: '/translate',
        element: <Translate />,
    },
    {
        path: '/recognize',
        element: <Recognize />,
    },
    {
        path: '/hotkey',
        element: <Hotkey />,
    },
    {
        path: '/service',
        element: <Service />,
    },
    {
        path: '/history',
        element: <History />,
    },
    {
        path: '/backup',
        element: <Backup />,
    },
    {
        path: '/about',
        element: <About />,
    },
    {
        path: '/',
        element: <Navigate to='/general' />,
    },
];

export default routes;
