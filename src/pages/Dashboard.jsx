import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { Line, Bar } from 'react-chartjs-2';
import { db } from './db';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';

// Register ChartJS components
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

const Dashboard = () => {
    const [webhookData, setWebhookData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [timeRange, setTimeRange] = useState('7d');
    const [selectedRepo, setSelectedRepo] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 10;

    useEffect(() => {
        const webhooksRef = collection(db, 'github_webhooks');
        const q = query(webhooksRef, orderBy('receivedAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = [];
            snapshot.forEach((doc) => {
                data.push({
                    id: doc.id,
                    ...doc.data()
                });
            });
            setWebhookData(data);
            console.log(data);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching data:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    // Process data for charts
    const processData = () => {
        // Filter by selected repo if not 'all'
        const filteredData = selectedRepo === 'all'
            ? webhookData
            : webhookData.filter(item => item.repository?.name === selectedRepo);

        // Filter by time range
        const now = new Date();
        let cutoffDate = new Date();

        switch (timeRange) {
            case '24h':
                cutoffDate.setDate(now.getDate() - 1);
                break;
            case '7d':
                cutoffDate.setDate(now.getDate() - 7);
                break;
            case '30d':
                cutoffDate.setDate(now.getDate() - 30);
                break;
            default:
                cutoffDate = new Date(0); // All time
        }

        const timeFilteredData = filteredData.filter(item => {
            const eventDate = new Date(item.receivedAt);
            return eventDate >= cutoffDate;
        });

        // Group data by event type
        const eventTypes = {};
        timeFilteredData.forEach(item => {
            const eventType = item.githubEvent || 'Unknown';
            eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;
        });

        // Group data by repository
        const repoActivity = {};
        timeFilteredData.forEach(item => {
            const repoName = item.repository?.name || 'Unknown';
            repoActivity[repoName] = (repoActivity[repoName] || 0) + 1;
        });

        // Group data by team (use team name from repo)
        const teamActivity = {};
        timeFilteredData.forEach(item => {
            const repoName = item.repository?.name || 'Unknown';
            const teamName = repoName.slice(5);
            teamActivity[teamName] = (teamActivity[teamName] || 0) + 1;
        });

        // Group data by date for time series
        const dailyActivity = {};
        let minDate = null;
        let maxDate = null;
        timeFilteredData.forEach(item => {
            const dateObj = new Date(item.receivedAt);
            dateObj.setHours(0,0,0,0);
            const date = dateObj.toLocaleDateString();
            dailyActivity[date] = (dailyActivity[date] || 0) + 1;
            if (!minDate || dateObj < minDate) minDate = new Date(dateObj);
            if (!maxDate || dateObj > maxDate) maxDate = new Date(dateObj);
        });
        // Fill in missing dates with 0
        const filledDailyActivity = {};
        if (minDate && maxDate) {
            const today = new Date();
            today.setHours(0,0,0,0);
            let endDate = maxDate > today ? maxDate : today;
            let current = new Date(minDate);
            while (current <= endDate) {
                const dateStr = current.toLocaleDateString();
                filledDailyActivity[dateStr] = dailyActivity[dateStr] || 0;
                current.setDate(current.getDate() + 1);
            }
        }

        // Group by user (sender.login, pusher.name, or pull_request.user.login)
        const userActivity = {};
        timeFilteredData.forEach(item => {
            let username = item.sender?.login || item.pusher?.name || item.pull_request?.user?.login || 'Unknown';
            userActivity[username] = (userActivity[username] || 0) + 1;
        });

        return {
            eventTypes,
            repoActivity,
            teamActivity,
            userActivity,
            dailyActivity: filledDailyActivity,
            totalEvents: timeFilteredData.length,
            uniqueRepos: Object.keys(repoActivity).length,
            uniqueTeams: Object.keys(teamActivity).length,
            filteredData // for pagination
        };
    };

    const {
        eventTypes,
        repoActivity,
        teamActivity,
        userActivity,
        dailyActivity,
        totalEvents,
        uniqueRepos,
        uniqueTeams,
        filteredData
    } = processData();

    // Calculate today's activity and teams worked today
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayStr = today.toLocaleDateString();
    const todaysEvents = filteredData.filter(item => {
        const eventDate = new Date(item.receivedAt);
        eventDate.setHours(0,0,0,0);
        return eventDate.toLocaleDateString() === todayStr;
    });
    const todaysActivity = todaysEvents.length;
    const teamsWorkedToday = new Set(todaysEvents.map(item => item.repository?.name.slice(5) || 'Unknown')).size;

    // Get top 5 teams and users (declare only once)
    const topTeams = Object.entries(teamActivity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    const topUsers = Object.entries(userActivity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    // Leaderboard: all users sorted by count
    const leaderboard = Object.entries(userActivity)
        .sort((a, b) => b[1] - a[1]);

    // Pagination logic
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    const paginatedData = filteredData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
    const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
    const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

    // Get unique repositories for dropdown
    const repositories = [...new Set(webhookData.map(item => item.repository?.name).filter(Boolean))];

    // Chart data configurations
    const eventTypeChartData = {
        labels: Object.keys(eventTypes),
        datasets: [
            {
                label: 'Event Types',
                data: Object.values(eventTypes),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.7)',
                    'rgba(54, 162, 235, 0.7)',
                    'rgba(255, 206, 86, 0.7)',
                    'rgba(75, 192, 192, 0.7)',
                    'rgba(153, 102, 255, 0.7)',
                    'rgba(255, 159, 64, 0.7)',
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)',
                ],
                borderWidth: 1,
            },
        ],
    };

    const repoActivityChartData = {
        labels: Object.keys(repoActivity),
        datasets: [
            {
                label: 'Repository Activity',
                data: Object.values(repoActivity),
                backgroundColor: 'rgba(54, 162, 235, 0.7)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1,
            },
        ],
    };

    const teamActivityChartData = {
        labels: Object.keys(teamActivity),
        datasets: [
            {
                label: 'Team Activity',
                data: Object.values(teamActivity),
                backgroundColor: 'rgba(75, 192, 192, 0.7)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1,
            },
        ],
    };

    const dailyActivityChartData = {
        labels: Object.keys(dailyActivity),
        datasets: [
            {
                label: 'Daily Activity',
                data: Object.values(dailyActivity),
                fill: false,
                backgroundColor: 'rgba(153, 102, 255, 0.7)',
                borderColor: 'rgba(153, 102, 255, 1)',
                tension: 0.1,
            },
        ],
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center">
                        <h1 className="text-3xl font-bold text-gray-900">GitHub Contest Analytics</h1>
                        <div className="flex space-x-4">
                            <select
                                className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={timeRange}
                                onChange={(e) => setTimeRange(e.target.value)}
                            >
                                <option value="24h">Last 24 hours</option>
                                <option value="7d">Last 7 days</option>
                                <option value="30d">Last 30 days</option>
                                <option value="all">All time</option>
                            </select>
                            <select
                                className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={selectedRepo}
                                onChange={(e) => setSelectedRepo(e.target.value)}
                            >
                                <option value="all">All Repositories</option>
                                {repositories.map(repo => (
                                    <option key={repo} value={repo}>{repo}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <div className="flex items-center">
                                <div className="flex-shrink-0 bg-indigo-500 rounded-md p-3">
                                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                    </svg>
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dt className="text-sm font-medium text-gray-500 truncate">Total Events</dt>
                                    <dd className="flex items-baseline">
                                        <div className="text-2xl font-semibold text-gray-900">{totalEvents}</div>
                                    </dd>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <div className="flex items-center">
                                <div className="flex-shrink-0 bg-green-500 rounded-md p-3">
                                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dt className="text-sm font-medium text-gray-500 truncate">Repositories</dt>
                                    <dd className="flex items-baseline">
                                        <div className="text-2xl font-semibold text-gray-900">{uniqueRepos}</div>
                                    </dd>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <div className="flex items-center">
                                <div className="flex-shrink-0 bg-blue-500 rounded-md p-3">
                                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" />
                                    </svg>
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dt className="text-sm font-medium text-gray-500 truncate">Today's Activity</dt>
                                    <dd className="flex items-baseline">
                                        <div className="text-2xl font-semibold text-gray-900">{todaysActivity}</div>
                                    </dd>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <div className="flex items-center">
                                <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
                                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
                                    </svg>
                                </div>
                                <div className="ml-5 w-0 flex-1">
                                    <dt className="text-sm font-medium text-gray-500 truncate">Teams Worked Today</dt>
                                    <dd className="flex items-baseline">
                                        <div className="text-2xl font-semibold text-gray-900">{teamsWorkedToday}</div>
                                    </dd>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-lg font-medium text-gray-900 mb-4">Team Activity</h2>
                        <div className="h-64">
                            <Bar
                                data={teamActivityChartData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: {
                                            display: false,
                                        },
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                        },
                                    },
                                }}
                            />
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-lg font-medium text-gray-900 mb-4">Daily Activity</h2>
                        <div className="h-64">
                            <Line
                                data={dailyActivityChartData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: {
                                            position: 'top',
                                        },
                                    },
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Top 5 Teams and Users */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <h2 className="text-lg font-medium text-gray-900 mb-4">Top 5 High Contributing Teams</h2>
                            <ol className="list-decimal ml-6">
                                {topTeams.map(([team, count]) => (
                                    <li key={team} className="mb-1 flex justify-between">
                                        <span>{team}</span>
                                        <span className="font-semibold">{count}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                        <div className="px-4 py-5 sm:p-6">
                            <h2 className="text-lg font-medium text-gray-900 mb-4">Top 5 High Contributing Users</h2>
                            <ol className="list-decimal ml-6">
                                {topUsers.map(([user, count]) => (
                                    <li key={user} className="mb-1 flex justify-between">
                                        <span>{user}</span>
                                        <span className="font-semibold">{count}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-lg font-medium text-gray-900 mb-4">Repository Activity</h2>
                        <div className="h-64">
                            <Bar
                                data={repoActivityChartData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: {
                                            display: false,
                                        },
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                        },
                                    },
                                }}
                            />
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow">
                        <h2 className="text-lg font-medium text-gray-900 mb-4">Team Activity</h2>
                        <div className="h-64">
                            <Bar
                                data={teamActivityChartData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: {
                                            display: false,
                                        },
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                        },
                                    },
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Recent Activity Table */}
                <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-lg">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h3 className="text-lg leading-6 font-medium text-gray-900">Recent Activity</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Event
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Repository
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Team
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Username
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Timestamp
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {paginatedData.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {item.githubEvent}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.repository?.name || 'Unknown'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.repository?.name.slice(5) || 'Unknown'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {item.sender?.login || item.pusher?.name || item.pull_request?.user?.login || 'Unknown'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(item.receivedAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {/* Pagination Controls */}
                        <div className="flex justify-between items-center py-2">
                            <button
                                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
                                onClick={handlePrevPage}
                                disabled={currentPage === 1}
                            >
                                Previous
                            </button>
                            <span>Page {currentPage} of {totalPages}</span>
                            <button
                                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
                                onClick={handleNextPage}
                                disabled={currentPage === totalPages}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
                {/* Leaderboard */}
                <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-lg">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h3 className="text-lg leading-6 font-medium text-gray-900">Leaderboard (All Users)</h3>
                    </div>
                    <div className="overflow-x-auto max-h-72" style={{overflowY: 'auto'}}>
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contributions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {leaderboard.map(([user, count], idx) => (
                                    <tr key={user}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{idx + 1}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
