import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Dimensions,
  Animated
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { collection, addDoc, onSnapshot, orderBy, query, updateDoc, doc, arrayUnion, arrayRemove, increment, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const CommentsScreen = ({ route, navigation }) => {
  const { postId, postData } = route.params;
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [likedComments, setLikedComments] = useState(new Set());
  const flatListRef = useRef(null);
  const inputRef = useRef(null);
  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  // Mock user data (replace with actual auth user)
  const currentUser = {
    id: auth.currentUser?.uid || 'user1',
    username: auth.currentUser?.displayName || 'currentuser',
    avatar: auth.currentUser?.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face'
  };

  useEffect(() => {
    // Animate screen in
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();

    loadComments();
  }, [postId]);

  const loadComments = () => {
    // Mock comments data with realistic social media interactions
    const mockComments = [
      {
        id: 'comment1',
        userId: 'user2',
        username: 'sarah_lifestyle',
        avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face',
        text: 'This is absolutely amazing! 🔥 Love the creativity!',
        timestamp: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
        likes: 24,
        replies: [
          {
            id: 'reply1',
            userId: 'user3',
            username: 'creative_mind',
            avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&h=100&fit=crop&crop=face',
            text: 'Totally agree! The editing is on point 💯',
            timestamp: new Date(Date.now() - 1000 * 60 * 10),
            likes: 8
          }
        ]
      },
      {
        id: 'comment2',
        userId: 'user4',
        username: 'photo_enthusiast',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face',
        text: 'Can you do a tutorial on this? Would love to learn! 🙏',
        timestamp: new Date(Date.now() - 1000 * 60 * 25),
        likes: 12,
        replies: []
      },
      {
        id: 'comment3',
        userId: 'user5',
        username: 'trendsetter_2024',
        avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face',
        text: 'First! 🥇 This content never disappoints',
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        likes: 45,
        replies: [
          {
            id: 'reply2',
            userId: 'user6',
            username: 'always_watching',
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
            text: 'Second! 😂 But yeah, quality content for sure',
            timestamp: new Date(Date.now() - 1000 * 60 * 28),
            likes: 15
          },
          {
            id: 'reply3',
            userId: 'user7',
            username: 'late_to_party',
            avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face',
            text: 'Third! Better late than never 😅',
            timestamp: new Date(Date.now() - 1000 * 60 * 25),
            likes: 6
          }
        ]
      },
      {
        id: 'comment4',
        userId: 'user8',
        username: 'music_lover_99',
        avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop&crop=face',
        text: 'What song is this? Shazam cant find it 🎵',
        timestamp: new Date(Date.now() - 1000 * 60 * 40),
        likes: 8,
        replies: []
      },
      {
        id: 'comment5',
        userId: 'user9',
        username: 'verification_squad',
        avatar: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=100&h=100&fit=crop&crop=face',
        text: 'This deserves way more views! Algorithm needs to push this 📈',
        timestamp: new Date(Date.now() - 1000 * 60 * 50),
        likes: 33,
        replies: [
          {
            id: 'reply4',
            userId: 'user10',
            username: 'algorithm_expert',
            avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop&crop=face',
            text: 'Engagement is everything! Keep commenting everyone 💪',
            timestamp: new Date(Date.now() - 1000 * 60 * 45),
            likes: 12
          }
        ]
      }
    ];

    setComments(mockComments);
    setLoading(false);
  };

  const handleSendComment = async () => {
    if (!newComment.trim()) return;

    const commentText = newComment.trim();
    setNewComment('');

    if (replyingTo) {
      // Handle reply
      const newReply = {
        id: `reply_${Date.now()}`,
        userId: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        text: `@${replyingTo.username} ${commentText}`,
        timestamp: new Date(),
        likes: 0
      };

      setComments(prevComments => 
        prevComments.map(comment => 
          comment.id === replyingTo.commentId
            ? { ...comment, replies: [...comment.replies, newReply] }
            : comment
        )
      );
      setReplyingTo(null);
    } else {
      // Handle new comment
      const newCommentObj = {
        id: `comment_${Date.now()}`,
        userId: currentUser.id,
        username: currentUser.username,
        avatar: currentUser.avatar,
        text: commentText,
        timestamp: new Date(),
        likes: 0,
        replies: []
      };

      setComments(prevComments => [newCommentObj, ...prevComments]);
    }

    // Scroll to top to show new comment
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ animated: true, offset: 0 });
    }, 100);
  };

  const handleLikeComment = (commentId, isReply = false, parentCommentId = null) => {
    const likeKey = isReply ? `${parentCommentId}_${commentId}` : commentId;
    const newLikedComments = new Set(likedComments);
    
    if (newLikedComments.has(likeKey)) {
      newLikedComments.delete(likeKey);
    } else {
      newLikedComments.add(likeKey);
    }
    
    setLikedComments(newLikedComments);

    // Update comment likes count
    setComments(prevComments => 
      prevComments.map(comment => {
        if (!isReply && comment.id === commentId) {
          return {
            ...comment,
            likes: newLikedComments.has(likeKey) ? comment.likes + 1 : comment.likes - 1
          };
        } else if (isReply && comment.id === parentCommentId) {
          return {
            ...comment,
            replies: comment.replies.map(reply => 
              reply.id === commentId
                ? { ...reply, likes: newLikedComments.has(likeKey) ? reply.likes + 1 : reply.likes - 1 }
                : reply
            )
          };
        }
        return comment;
      })
    );
  };

  const handleReply = (comment, isReply = false, parentCommentId = null) => {
    setReplyingTo({
      commentId: isReply ? parentCommentId : comment.id,
      username: comment.username,
      text: comment.text
    });
    inputRef.current?.focus();
  };

  const formatTimestamp = (timestamp) => {
    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  };

  const closeComments = () => {
    Animated.spring(slideAnim, {
      toValue: screenHeight,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start(() => {
      navigation.goBack();
    });
  };

  const renderReply = ({ item: reply, index }, parentComment) => {
    const likeKey = `${parentComment.id}_${reply.id}`;
    const isLiked = likedComments.has(likeKey);

    return (
      <View style={styles.replyContainer}>
        <View style={styles.replyLine} />
        <TouchableOpacity style={styles.commentItem}>
          <Image source={{ uri: reply.avatar }} style={styles.replyAvatar} />
          <View style={styles.commentContent}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentUsername}>{reply.username}</Text>
              <Text style={styles.commentTime}>{formatTimestamp(reply.timestamp)}</Text>
            </View>
            <Text style={styles.commentText}>{reply.text}</Text>
            <View style={styles.commentActions}>
              <TouchableOpacity 
                style={styles.commentAction}
                onPress={() => handleLikeComment(reply.id, true, parentComment.id)}
              >
                <Ionicons 
                  name={isLiked ? "heart" : "heart-outline"} 
                  size={16} 
                  color={isLiked ? "#ff1744" : "#666"} 
                />
                <Text style={[styles.commentActionText, isLiked && { color: '#ff1744' }]}>
                  {reply.likes}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.commentAction}
                onPress={() => handleReply(reply, true, parentComment.id)}
              >
                <Text style={styles.commentActionText}>Reply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderComment = ({ item: comment, index }) => {
    const isLiked = likedComments.has(comment.id);

    return (
      <View style={styles.commentContainer}>
        <TouchableOpacity style={styles.commentItem}>
          <Image source={{ uri: comment.avatar }} style={styles.commentAvatar} />
          <View style={styles.commentContent}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentUsername}>{comment.username}</Text>
              <Text style={styles.commentTime}>{formatTimestamp(comment.timestamp)}</Text>
            </View>
            <Text style={styles.commentText}>{comment.text}</Text>
            <View style={styles.commentActions}>
              <TouchableOpacity 
                style={styles.commentAction}
                onPress={() => handleLikeComment(comment.id)}
              >
                <Ionicons 
                  name={isLiked ? "heart" : "heart-outline"} 
                  size={16} 
                  color={isLiked ? "#ff1744" : "#666"} 
                />
                <Text style={[styles.commentActionText, isLiked && { color: '#ff1744' }]}>
                  {comment.likes}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.commentAction}
                onPress={() => handleReply(comment)}
              >
                <Text style={styles.commentActionText}>Reply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
        
        {/* Render Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <FlatList
            data={comment.replies}
            renderItem={(props) => renderReply(props, comment)}
            keyExtractor={(reply) => reply.id}
            scrollEnabled={false}
          />
        )}
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.postSummary}>
      <View style={styles.postHeader}>
        <Image 
          source={{ uri: postData?.user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }}
          style={styles.postAvatar}
        />
        <View style={styles.postInfo}>
          <Text style={styles.postUsername}>@{postData?.user?.username || 'creator'}</Text>
          <Text style={styles.postDescription} numberOfLines={2}>
            {postData?.description || postData?.caption || 'Amazing content!'}
          </Text>
        </View>
      </View>
      <View style={styles.commentsHeader}>
        <Text style={styles.commentsTitle}>Comments ({comments.length})</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Animated.View 
        style={[
          styles.content,
          { transform: [{ translateY: slideAnim }] }
        ]}
      >
        <LinearGradient colors={['#000000', '#1a1a1a']} style={styles.gradient}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeButton} onPress={closeComments}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Comments</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Comments List */}
          <FlatList
            ref={flatListRef}
            data={comments}
            renderItem={renderComment}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={renderHeader}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.commentsList}
          />

          {/* Reply Preview */}
          {replyingTo && (
            <View style={styles.replyPreview}>
              <Text style={styles.replyPreviewText}>
                Replying to @{replyingTo.username}
              </Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)}>
                <Ionicons name="close" size={20} color="#666" />
              </TouchableOpacity>
            </View>
          )}

          {/* Comment Input */}
          <View style={styles.inputContainer}>
            <Image source={{ uri: currentUser.avatar }} style={styles.inputAvatar} />
            <View style={styles.inputWrapper}>
              <TextInput
                ref={inputRef}
                style={styles.commentInput}
                placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : "Add a comment..."}
                placeholderTextColor="#666"
                value={newComment}
                onChangeText={setNewComment}
                multiline
                maxLength={500}
              />
              <TouchableOpacity 
                style={[styles.sendButton, !newComment.trim() && styles.sendButtonDisabled]}
                onPress={handleSendComment}
                disabled={!newComment.trim()}
              >
                <LinearGradient
                  colors={newComment.trim() ? ['#ec4899', '#be185d'] : ['#374151', '#374151']}
                  style={styles.sendGradient}
                >
                  <Ionicons name="send" size={20} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  content: {
    flex: 1,
    marginTop: screenHeight * 0.3,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  postSummary: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  postAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
  },
  postUsername: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  postDescription: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 2,
  },
  commentsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  commentsList: {
    paddingBottom: 20,
  },
  commentContainer: {
    marginBottom: 8,
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  replyAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 10,
  },
  commentContent: {
    flex: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentUsername: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 8,
  },
  commentTime: {
    fontSize: 12,
    color: '#666',
  },
  commentText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
    marginBottom: 8,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
    paddingVertical: 4,
  },
  commentActionText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontWeight: '600',
  },
  replyContainer: {
    paddingLeft: 48,
  },
  replyLine: {
    position: 'absolute',
    left: 32,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#333',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  inputAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    borderRadius: 20,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#2a2a2a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  replyPreviewText: {
    color: '#ec4899',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default CommentsScreen;