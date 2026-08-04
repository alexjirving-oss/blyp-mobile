import React, { useState, useRef } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  FlatList,
  Dimensions,
  Animated
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import searchService from '../services/searchService';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const SearchBar = ({ navigation, placeholder = "Search...", onSearch }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  const openSearchModal = () => {
    setIsModalVisible(true);
    loadSuggestions();
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  };

  const closeSearchModal = () => {
    Animated.spring(slideAnim, {
      toValue: screenHeight,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start(() => {
      setIsModalVisible(false);
      setSearchQuery('');
      setSuggestions([]);
    });
  };

  const loadSuggestions = async () => {
    try {
      const suggestionsData = searchService.getSearchSuggestions();
      setSuggestions(suggestionsData);
    } catch (error) {
      console.error('âŒ Error loading suggestions:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setIsLoading(true);
      
      // Add to search history
      searchService.addToSearchHistory(searchQuery);
      
      if (onSearch) {
        onSearch(searchQuery);
      } else if (navigation) {
        navigation.navigate('SearchResults', { query: searchQuery });
      }
      
      closeSearchModal();
    } catch (error) {
      console.error('âŒ Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionPress = (suggestion) => {
    setSearchQuery(suggestion);
    handleSearch();
  };

  const renderSuggestionItem = ({ item, section }) => (
    <TouchableOpacity
      style={styles.suggestionItem}
      onPress={() => handleSuggestionPress(item)}
    >
      <Icon  
        name={section === 'trending' ? 'trending-up' : 'time-outline'} 
        size={16} 
        color={section === 'trending' ? '#00D2BE' : '#666'} 
       />
      <Text style={styles.suggestionText}>{item}</Text>
      <Icon  name="arrow-up-outline" size={16} color="#666" style={styles.suggestionArrow}  />
    </TouchableOpacity>
  );

  const renderSearchContent = () => (
    <View style={styles.searchContent}>
      {/* Quick Actions */}
      <View style={styles.quickActions}>
        {[
          { icon: 'people', label: 'Users', color: '#3b82f6' },
          { icon: 'grid', label: 'Posts', color: '#00D2BE' },
          { icon: 'pricetag', label: 'Tags', color: '#f59e0b' },
          { icon: 'location', label: 'Places', color: '#10b981' },
        ].map((action, index) => (
          <TouchableOpacity 
            key={index}
            style={styles.quickAction}
            onPress={() => {
              if (navigation) {
                navigation.navigate('SearchResults', { 
                  query: '', 
                  type: action.label.toLowerCase() 
                });
              }
              closeSearchModal();
            }}
          >
            <LinearGradient
              colors={[action.color, action.color + '80']}
              style={styles.quickActionIcon}
            >
              <Icon  name={action.icon} size={24} color="#fff"  />
            </LinearGradient>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Searches */}
      {suggestions?.recent && suggestions.recent.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Searches</Text>
          <FlatList
            data={suggestions.recent}
            renderItem={({ item }) => renderSuggestionItem({ item, section: 'recent' })}
            keyExtractor={(item, index) => `recent-${index}`}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}

      {/* Trending */}
      {suggestions?.trending && suggestions.trending.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Icon  name="flame" size={20} color="#00D2BE"  />
            <Text style={styles.sectionTitle}>Trending Now</Text>
          </View>
          <FlatList
            data={suggestions.trending}
            renderItem={({ item }) => renderSuggestionItem({ item, section: 'trending' })}
            keyExtractor={(item, index) => `trending-${index}`}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );

  return (
    <>
      <TouchableOpacity style={styles.searchBar} onPress={openSearchModal}>
        <Icon  name="search" size={20} color="#666"  />
        <Text style={styles.searchPlaceholder}>{placeholder}</Text>
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="none"
        onRequestClose={closeSearchModal}
      >
        <View style={styles.modalOverlay}>
          <Animated.View 
            style={[
              styles.modalContent,
              { transform: [{ translateY: slideAnim }] }
            ]}
          >
            <LinearGradient colors={['#000000', '#1a1a1a']} style={styles.modalGradient}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.searchInputContainer}>
                  <Icon  name="search" size={20} color="#666" style={styles.searchIcon}  />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={placeholder}
                    placeholderTextColor="#666"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus={true}
                    returnKeyType="search"
                    onSubmitEditing={handleSearch}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <Icon  name="close-circle" size={20} color="#666"  />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity style={styles.cancelButton} onPress={closeSearchModal}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>

              {/* Search Content */}
              {renderSearchContent()}
            </LinearGradient>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flex: 1,
  },
  searchPlaceholder: {
    color: '#666',
    marginLeft: 8,
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  modalContent: {
    flex: 1,
    marginTop: 0,
  },
  modalGradient: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cancelButtonText: {
    color: '#00D2BE',
    fontSize: 16,
    fontWeight: '600',
  },
  searchContent: {
    flex: 1,
    padding: 16,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  quickAction: {
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  suggestionText: {
    flex: 1,
    color: '#ccc',
    fontSize: 16,
    marginLeft: 12,
  },
  suggestionArrow: {
    transform: [{ rotate: '45deg' }],
  },
});

export default SearchBar;