import React, { useState, useEffect, useCallback } from 'react'
import { Toaster } from 'react-hot-toast'
import LoginPage from './components/LoginPage'
import SearchPanel from './components/SearchPanel'
import LeadTable from './components/LeadTable'
import StatsBar from './components/StatsBar'
import api from './api'
import toast from 'react-hot-toast'

export default function App() {
    const [token, setToken] = useState(localStorage.getItem('df_token'))
    const [leads, setLeads] = useState([])
    const [loading, setLoading] = useState(false)
    const [filter, setFilter] = useState('ALL')

    const fetchLeads = useCallback(async () => {
        if (!token) return
        try {
            const res = await api.get('/leads')
            setLeads(res.data.leads || [])
        } catch (err) {
            if (err.response?.status === 401 || err.response?.status === 403) {
                handleLogout()
            }
        }
    }, [token])

    useEffect(() => {
        fetchLeads()
    }, [fetchLeads])

    function handleLogout() {
        localStorage.removeItem('df_token')
        setToken(null)
        setLeads([])
    }

    async function handleSearch(criteria) {
        setLoading(true)
        try {
            const res = await api.post('/leads/search', criteria)
            setLeads(res.data.leads || [])
            toast.success(`Found ${res.data.count} properties`)
        } catch (err) {
            toast.error(err.response?.data?.error || 'Search failed.')
        } finally {
            setLoading(false)
        }
    }

    function handleExport() {
        const link = document.createElement('a')
        link.href = '/api/leads/export'
        link.click()
    }

    const filteredLeads = filter === 'ALL'
        ? leads
        : leads.filter(l => l.motivationClass === filter)

    if (!token) {
        return (
            <>
                <Toaster position="top-right" toastOptions={{ style: { background: '#1e1e2e', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.1)' } }} />
                <LoginPage onLogin={setToken} />
            </>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-dark">
            <Toaster position="top-right" toastOptions={{ style: { background: '#1e1e2e', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.1)' } }} />

            {/* Ambient glows */}
            <div className="fixed top-0 left-0 w-96 h-96 bg-purple-600/8 rounded-full blur-3xl pointer-events-none" />
            <div className="fixed bottom-0 right-0 w-96 h-96 bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <header className="border-b border-white/5 bg-black/20 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-lg">🔍</div>
                        <div>
                            <h1 className="text-white font-bold text-lg leading-none">The Distress Filter</h1>
                            <p className="text-slate-500 text-xs">Motivated Seller Intelligence</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Filter tabs */}
                        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                            {['ALL', 'HOT', 'WARM', 'COLD'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filter === f ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                                >
                                    {f === 'HOT' ? '🔥' : f === 'WARM' ? '🌡' : f === 'COLD' ? '❄️' : ''} {f}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={handleExport}
                            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs px-3 py-2 rounded-lg transition-all"
                        >
                            ⬇ Export CSV
                        </button>

                        <button
                            onClick={handleLogout}
                            className="text-slate-500 hover:text-red-400 text-xs px-3 py-2 rounded-lg hover:bg-red-500/10 transition-all"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </header>

            {/* Main layout */}
            <div className="max-w-screen-xl mx-auto px-6 py-6 flex gap-6">
                {/* Left: Search Panel */}
                <aside className="w-72 flex-shrink-0">
                    <SearchPanel onSearch={handleSearch} loading={loading} />

                    {/* Score Legend */}
                    <div className="glass p-4 mt-4 text-xs space-y-2">
                        <p className="text-slate-500 font-semibold uppercase tracking-wider mb-3">Score Breakdown</p>
                        {[
                            { label: 'High Equity >40%', pts: '+30' },
                            { label: 'Absentee Owner', pts: '+25' },
                            { label: 'Owned 10+ Years', pts: '+20' },
                            { label: 'Pre-Foreclosure/NOD', pts: '+30' },
                            { label: 'Tax Delinquent', pts: '+25' },
                        ].map(item => (
                            <div key={item.label} className="flex justify-between text-slate-400">
                                <span>{item.label}</span>
                                <span className="text-purple-400 font-semibold">{item.pts}</span>
                            </div>
                        ))}
                        <div className="border-t border-white/5 pt-2 space-y-1">
                            <div className="flex justify-between"><span className="text-red-400">🔥 HOT</span><span className="text-slate-500">70–100</span></div>
                            <div className="flex justify-between"><span className="text-yellow-400">🌡 WARM</span><span className="text-slate-500">40–69</span></div>
                            <div className="flex justify-between"><span className="text-blue-400">❄️ COLD</span><span className="text-slate-500">0–39</span></div>
                        </div>
                    </div>
                </aside>

                {/* Right: Results */}
                <main className="flex-1 min-w-0 space-y-4">
                    {leads.length > 0 && <StatsBar leads={leads} />}
                    <LeadTable leads={filteredLeads} onRefresh={fetchLeads} />
                </main>
            </div>
        </div>
    )
}
