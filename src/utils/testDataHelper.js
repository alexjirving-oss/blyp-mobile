import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

/**
 * Add test posts with multiple photos to Firebase
 * This is for testing the PhotoGallery functionality
 */
export const addTestPostsWithMultiplePhotos = async () => {
  console.log('🧪 Adding test posts with multiple photos...');
  
  try {
    // Test post with 3 sample photos
    const testPost1 = {
      userId: 'test-user-1',
      username: 'Test User',
      userPhotoURL: null,
      title: 'Beautiful Nature Gallery',
      transcript: 'Stunning mountain landscapes captured during golden hour - the way light dances across these peaks is absolutely magical! Each photo tells a story of adventure and natural beauty. 🏔️✨',
      description: 'A breathtaking collection of mountain photography showcasing dramatic landscapes, golden hour lighting, and the raw beauty of untouched wilderness.',
      caption: 'Nature is amazing! 🌲🌸 #nature #photography #hiking #mountains #goldenhour',
      tags: ['nature', 'photography', 'hiking', 'mountains', 'goldenhour'],
      emoji: '📸',
      media: [
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=600&fit=crop'
        },
        {
          type: 'photo', 
          url: 'https://images.unsplash.com/photo-1464822759844-d150065c142f?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1464822759844-d150065c142f?w=400&h=600&fit=crop'
        },
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1519904981063-b0cf448d479e?w=400&h=600&fit=crop', 
          uri: 'https://images.unsplash.com/photo-1519904981063-b0cf448d479e?w=400&h=600&fit=crop'
        }
      ],
      type: 'photo',
      videoUrl: null,
      imageUrl: null,
      thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=600&fit=crop',
      user: {
        username: 'Test User',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face'
      },
      likes: 12,
      comments: 3,
      shares: 2,
      sharedTo: ['instagram', 'facebook'],
      date: serverTimestamp(),
      likeCount: 12,
      commentCount: 3
    };

    // Test post with 5 sample photos  
    const testPost2 = {
      userId: 'test-user-2',
      username: 'Photo Explorer',
      userPhotoURL: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face',
      title: 'City Life Collection',
      transcript: 'Exploring the vibrant energy of urban landscapes - from towering skyscrapers reflecting golden light to intimate street corners where life happens. Each frame captures the pulse of the city and the stories that unfold in concrete jungles. 🏙️🚶‍♀️',
      description: 'A dynamic street photography series showcasing the contrast between architectural grandeur and human moments in the urban environment.',
      caption: 'City vibes and urban adventures 🌆📷 #streetphotography #urban #city #architecture #citylife',
      tags: ['streetphotography', 'urban', 'city', 'architecture', 'citylife'],
      emoji: '🌆',
      media: [
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=600&fit=crop'
        },
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&h=600&fit=crop', 
          uri: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&h=600&fit=crop'
        },
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&h=600&fit=crop'
        },
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=400&h=600&fit=crop'
        },
        {
          type: 'photo',
          url: 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=400&h=600&fit=crop',
          uri: 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=400&h=600&fit=crop'
        }
      ],
      type: 'photo',
      videoUrl: null,
      imageUrl: null,
      thumbnail: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=600&fit=crop',
      user: {
        username: 'Photo Explorer', 
        avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face'
      },
      likes: 25,
      comments: 8,
      shares: 5,
      sharedTo: ['instagram'],
      date: serverTimestamp(),
      likeCount: 25,
      commentCount: 8
    };

    // Add posts to Firebase
    const docRef1 = await addDoc(collection(db, 'posts'), testPost1);
    console.log('✅ Test post 1 added with ID:', docRef1.id);
    
    const docRef2 = await addDoc(collection(db, 'posts'), testPost2);  
    console.log('✅ Test post 2 added with ID:', docRef2.id);

    console.log('🎉 Test posts with multiple photos added successfully!');
    return { success: true, postIds: [docRef1.id, docRef2.id] };

  } catch (error) {
    console.error('❌ Error adding test posts:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Clear test posts (optional cleanup function)
 */
export const clearTestPosts = async () => {
  console.log('🧹 This would clear test posts (implement if needed)');
  // Implementation would require querying and deleting test posts
  // Left as optional for now
};