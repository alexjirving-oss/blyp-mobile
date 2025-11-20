// Mock data for development and testing
export const mockVideoData = [
  {
    id: 'video-1',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
    user: { 
      username: '@alex_creator', 
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' 
    },
    description: 'Amazing sunset vibes! 🌅 Perfect golden hour captured in the mountains #sunset #nature #peaceful #goldenhour',
    likes: 1234,
    comments: [
      { user: 'nature_lover', text: 'Breathtaking! 😍' },
      { user: 'photographer', text: 'What camera did you use?' },
      { user: 'hiker_girl', text: 'Location please!' }
    ],
    shares: 45,
    views: 12340,
    music: 'Original Sound - alex_creator'
  },
  {
    id: 'video-2',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4',
    user: { 
      username: '@travel_buddy', 
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face' 
    },
    description: 'City life hits different at night ✨🏙️ The energy is unmatched! #cityvibes #nightlife #urban #travel',
    likes: 2156,
    comments: [
      { user: 'city_explorer', text: 'Which city is this?' },
      { user: 'night_owl', text: 'Love the vibes!' },
      { user: 'urban_photographer', text: 'Amazing shots! 📸' }
    ],
    shares: 78,
    views: 21560,
    music: 'Trending - City Nights'
  },
  {
    id: 'video-3',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_5mb.mp4',
    user: { 
      username: '@foodie_life', 
      avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&h=100&fit=crop&crop=face' 
    },
    description: 'Making the perfect pasta 🍝 Who wants the recipe? This took 3 hours but so worth it! #cooking #pasta #foodie #recipe #italian',
    likes: 3421,
    comments: [
      { user: 'pasta_lover', text: 'Recipe please! 🙏' },
      { user: 'italian_chef', text: 'Looks authentic!' },
      { user: 'hungry_student', text: 'Making this tonight!' }
    ],
    shares: 156,
    views: 34210,
    music: 'Cooking Vibes - Chef Sounds'
  },
  {
    id: 'video-4',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
    user: { 
      username: '@fitness_guru', 
      avatar: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=100&h=100&fit=crop&crop=face' 
    },
    description: 'Morning workout routine 💪 Start your day right! No equipment needed #fitness #workout #morning #health #motivation',
    likes: 892,
    comments: [
      { user: 'fitness_fan', text: 'This is perfect!' },
      { user: 'morning_person', text: 'Love the energy!' }
    ],
    shares: 34,
    views: 8920,
    music: 'Pump It Up - Workout Mix'
  },
  {
    id: 'video-5',
    type: 'video',
    videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_2mb.mp4',
    user: { 
      username: '@tech_reviewer', 
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face' 
    },
    description: 'This new gadget is INSANE! 📱 Game changer for creators #tech #gadget #review #creator #innovation',
    likes: 1567,
    comments: [
      { user: 'tech_enthusiast', text: 'Need this!' },
      { user: 'creator_life', text: 'Where can I buy it?' }
    ],
    shares: 67,
    views: 15670,
    music: 'Tech Beats - Digital Sounds'
  }
];

export const mockCommentsData = [
  { user: 'sarah_m', text: 'This is amazing! 🔥', time: '2m' },
  { user: 'john_doe', text: 'Love the vibes ✨', time: '5m' },
  { user: 'creative_mind', text: 'So inspiring!', time: '8m' },
  { user: 'photo_lover', text: 'Goals! 💯', time: '12m' },
  { user: 'daily_content', text: 'Need more like this', time: '15m' },
  { user: 'wanderlust_soul', text: 'Perfect timing', time: '18m' },
  { user: 'art_enthusiast', text: 'Incredible work', time: '22m' },
  { user: 'lifestyle_blogger', text: 'Obsessed with this!', time: '25m' },
  { user: 'travel_addict', text: 'Where is this?', time: '28m' },
  { user: 'foodie_life', text: 'Recipe please! 🙏', time: '30m' },
  { user: 'fitness_guru', text: 'Motivation right here', time: '35m' },
  { user: 'tech_lover', text: 'Mind blown 🤯', time: '40m' },
  { user: 'music_fan', text: 'What song is this?', time: '45m' },
  { user: 'nature_lover', text: 'Absolutely beautiful', time: '1h' },
  { user: 'creative_studio', text: 'Pure artistry', time: '1h' }
];

export const UI_CONSTANTS = {
  HEADER_HEIGHT: 120,
  FOOTER_HEIGHT: 88,
  CARD_PADDING: 16,
  SECTION_MARGIN: 20,
  BORDER_RADIUS: 12,
  AVATAR_SIZE: 50,
  ICON_SIZE: 24,
};

export const ANIMATION_DURATIONS = {
  FAST: 200,
  MEDIUM: 300,
  SLOW: 500,
};

export default {
  mockVideoData,
  mockCommentsData,
  UI_CONSTANTS,
  ANIMATION_DURATIONS,
};