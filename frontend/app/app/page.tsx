"use client";

import { useState } from 'react';
import { TrendingUp, Bot, BarChart3, PieChart, Activity, MessageSquare, Upload, Settings, Bell, Star, ArrowRight, DollarSign, Percent, Calendar, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import AuthStatusBanner from '@/components/AuthStatusBanner';
import Link from 'next/link';

export default function HomePage() {
  const { user } = useAuth();
  const [notifications] = useState(3);

  return (
    <div className="space-y-8">
      {/* Authentication Status Banner */}
      <AuthStatusBanner />
      
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Welcome back, {user?.firstName}! 👋
            </h1>
            <p className="text-blue-100 text-lg">
              Ready to analyze the markets and optimize your portfolio?
            </p>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold">$124.5K</div>
              <div className="text-blue-200 text-sm">Portfolio Value</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-300">+12.4%</div>
              <div className="text-blue-200 text-sm">This Month</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-4 gap-6">
        <Link href="/chat">
          <Card className="p-6 hover:shadow-lg transition-all duration-300 cursor-pointer border-2 hover:border-blue-300 group">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <MessageSquare className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">AI Chat</h3>
                <p className="text-gray-600 text-sm">Ask anything</p>
              </div>
            </div>
          </Card>
        </Link>

        <Card className="p-6 hover:shadow-lg transition-all duration-300 cursor-pointer border-2 hover:border-green-300 group">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center group-hover:bg-green-200 transition-colors">
              <Upload className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Upload Data</h3>
              <p className="text-gray-600 text-sm">Analyze files</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-all duration-300 cursor-pointer border-2 hover:border-purple-300 group">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center group-hover:bg-purple-200 transition-colors">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Portfolio</h3>
              <p className="text-gray-600 text-sm">View holdings</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 hover:shadow-lg transition-all duration-300 cursor-pointer border-2 hover:border-orange-300 group">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center group-hover:bg-orange-200 transition-colors">
              <Settings className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Settings</h3>
              <p className="text-gray-600 text-sm">Preferences</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Dashboard Content */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Portfolio Overview */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Portfolio Overview</h2>
              <Button variant="outline" size="sm">
                View Details
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-green-800 font-medium">Total Value</p>
                      <p className="text-green-600 text-sm">Current portfolio</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-800">$124,567</p>
                    <p className="text-green-600 text-sm">+$13,425 today</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                      <Percent className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-blue-800 font-medium">Returns</p>
                      <p className="text-blue-600 text-sm">This month</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-800">+12.4%</p>
                    <p className="text-blue-600 text-sm">vs +8.2% S&P 500</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
                      <Activity className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-purple-800 font-medium">Risk Score</p>
                      <p className="text-purple-600 text-sm">Current level</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-purple-800">7.2/10</p>
                    <p className="text-purple-600 text-sm">Moderate</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-orange-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                      <Target className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-orange-800 font-medium">AI Score</p>
                      <p className="text-orange-600 text-sm">Optimization</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-orange-800">8.7/10</p>
                    <p className="text-orange-600 text-sm">Excellent</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Recent Activity */}
          <Card className="p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Activity</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">AI Analysis Complete</p>
                  <p className="text-gray-600 text-sm">Portfolio rebalancing recommendations generated</p>
                </div>
                <div className="text-sm text-gray-500">2 hours ago</div>
              </div>

              <div className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Market Alert</p>
                  <p className="text-gray-600 text-sm">AAPL reached your target price of $180</p>
                </div>
                <div className="text-sm text-gray-500">4 hours ago</div>
              </div>

              <div className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center">
                  <PieChart className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Portfolio Updated</p>
                  <p className="text-gray-600 text-sm">Added 50 shares of MSFT to your portfolio</p>
                </div>
                <div className="text-sm text-gray-500">1 day ago</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* AI Assistant Card */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">AI Assistant</h3>
                <p className="text-gray-600 text-sm">Ready to help</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-blue-800 text-sm font-medium">💡 Suggestion</p>
                <p className="text-blue-700 text-sm mt-1">
                  Consider rebalancing your tech allocation - it's currently 35% vs recommended 28%.
                </p>
              </div>
              
              <Link href="/chat">
                <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Start Conversation
                </Button>
              </Link>
            </div>
          </Card>

          {/* Market Highlights */}
          <Card className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Market Highlights</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">S&P 500</span>
                <div className="text-right">
                  <span className="font-medium">4,185.02</span>
                  <span className="text-green-600 text-sm ml-2">+0.8%</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-600">NASDAQ</span>
                <div className="text-right">
                  <span className="font-medium">12,888.85</span>
                  <span className="text-green-600 text-sm ml-2">+1.2%</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-gray-600">DOW</span>
                <div className="text-right">
                  <span className="font-medium">33,745.40</span>
                  <span className="text-red-600 text-sm ml-2">-0.3%</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Notifications */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              <div className="flex items-center space-x-1">
                <Bell className="w-4 h-4 text-gray-500" />
                {notifications > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {notifications}
                  </span>
                )}
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded">
                <p className="text-yellow-800 text-sm font-medium">Price Alert</p>
                <p className="text-yellow-700 text-sm">TSLA hit your stop loss at $220</p>
              </div>
              
              <div className="p-3 bg-green-50 border-l-4 border-green-400 rounded">
                <p className="text-green-800 text-sm font-medium">Portfolio Milestone</p>
                <p className="text-green-700 text-sm">Reached $125K total value!</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

