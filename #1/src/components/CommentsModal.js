import React, { useState } from 'react';
import Icon from '../../../src/components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const CommentsModal = ({ visible, onClose, postId, postData }) => {
  const [comments, setComments] = useState([
    {
      id: '1',
      username: 'sarah_lifestyle',
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=100&h=100&fit=crop&crop=face',
      text: 'This is absolutely amazing! 🔥',
      time: '2m',
      likes: 24,
      replies: []
    },
    {
      id: '2',
      username: 'creative_mind',
      avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=100&h=100&fit=crop&crop=face',
      text: 'Love the creativity! Can you do a tutorial? 🙏',
      time: '5m',
      likes: 12,
      replies: []
    },
    {
      id: '3',
      username: 'trendsetter_2024',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face',
      text: 'First! 🥇 This content never disappoints',
      time: '8m',
      likes: 45,
      replies: []
    }
  ]);
  const [newComment, setNewComment] = useState('');
  const [likedComments, setLikedComments] = useState(new Set());

  const handleSendComment = () => {
    if (!newComment.trim()) return;

    const comment = {
      id: Date.now().toString(),
      username: 'you',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face',
      text: newComment,
      time: 'now',
      likes: 0,
      replies: []
    };

    setComments([comment, ...comments]);
    setNewComment('');
  };

  const handleLikeComment = (commentId) => {
    const newLikedComments = new Set(likedComments);
    if (newLikedComments.has(commentId)) {
      newLikedComments.delete(commentId);
    } else {
      newLikedComments.add(commentId);
    }
    setLikedComments(newLikedComments);

    setComments(comments.map(comment => 
      comment.id === commentId
        ? { ...comment, likes: newLikedComments.has(commentId) ? comment.likes + 1 : comment.likes - 1 }
        : comment
    ));
  };

  const renderComment = ({ item }) => {
    const isLiked = likedComments.has(item.id);

    return (
      <View style={styles.commentItem}>
        <Image source={{ uri: item.avatar }} style={styles.commentAvatar} />
        <View style={styles.commentContent}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentUsername}>{item.username}</Text>
            <Text style={styles.commentTime}>{item.time}</Text>
          </View>
          <Text style={styles.commentText}>{item.text}</Text>
          <View style={styles.commentActions}>
            <TouchableOpacity 
              style={styles.commentAction}
              onPress={() => handleLikeComment(item.id)}
            >
              <Icon  
                name={isLiked ? "heart" : "heart-outline"} 
                size={16} 
                color={isLiked ? "#ff1744" : "#666"} 
               />
              <Text style={[styles.commentActionText, isLiked && { color: '#ff1744' }]}>
                {item.likes}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentAction}>
              <Text style={styles.commentActionText}>Reply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        style={styles.modalContainer} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={42}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <LinearGradient colors={['transparent', 'transparent']} style={styles.gradient}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}>
                <Icon  name="close" size={28} color="#fff"  />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Comments</Text>
              <View style={{ width: 28 }} />
            </View>

            {/* Post Summary */}
            <View style={styles.postSummary}>
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

            {/* Comments List */}
            <FlatList
              data={comments}
              renderItem={renderComment}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.commentsList}
            />

            {/* Comment Input */}
            <View style={styles.inputContainer}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face' }} 
                style={styles.inputAvatar} 
              />
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Add a comment..."
                  placeholderTextColor="#666"
                  value={newComment}
                  onChangeText={setNewComment}
                  multiline
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
                    <Icon  name="send" size={18} color="#fff"  />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContent: {
    height: screenHeight * 0.7,
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  postSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
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
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  postDescription: {
    fontSize: 12,
    color: '#ccc',
    marginTop: 2,
  },
  commentsList: {
    paddingVertical: 8,
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 8,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
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
  },
  commentActionText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  inputAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 14,
    maxHeight: 80,
    marginRight: 8,
  },
  sendButton: {
    borderRadius: 18,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default CommentsModal;