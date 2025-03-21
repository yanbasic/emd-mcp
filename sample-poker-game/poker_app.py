import streamlit as st
st.set_page_config(layout="wide")
from PIL import Image
import base64
import requests
import io
import random
import json
import emd
from emd.sdk.invoke.vlm_invoker import VLMInvoker
from emd.sdk.invoke.conversation_invoker import ConversationInvoker

CARD_VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A']

# Default model settings
DEFAULT_LLM_MODEL_ID = 'DeepSeek-R1-Distill-Qwen-32B'
DEFAULT_LLM_MODEL_TAG = 'dev'
DEFAULT_VLM_MODEL_ID = 'gemma-3-27b-it'
DEFAULT_VLM_MODEL_TAG = 'dev'

# LLM model options with their corresponding tags
LLM_MODEL_OPTIONS = {
    'DeepSeek-R1-Distill-Qwen-32B': 'dev',
    'QwQ-32B': 'poker'
}

# VLM model options with their corresponding tags
VLM_MODEL_OPTIONS = {
    'gemma-3-27b-it': 'dev'
}

previous_selected_llm = ''

# Initialize model settings in session state if not present
if 'llm_model_id' not in st.session_state:
    st.session_state.llm_model_id = DEFAULT_LLM_MODEL_ID
if 'llm_model_tag' not in st.session_state:
    st.session_state.llm_model_tag = DEFAULT_LLM_MODEL_TAG
if 'vlm_model_id' not in st.session_state:
    st.session_state.vlm_model_id = DEFAULT_VLM_MODEL_ID
if 'vlm_model_tag' not in st.session_state:
    st.session_state.vlm_model_tag = DEFAULT_VLM_MODEL_TAG

def deal_cards():
    # Create single deck with unique cards
    deck = CARD_VALUES.copy()
    random.shuffle(deck)
    
    # Deal 5 unique cards to each player from same deck
    human_cards = deck[:5]
    ai_cards = deck[5:10]
    
    # Verify no duplicates between players
    if len(set(human_cards + ai_cards)) != 10:
        raise ValueError("Duplicate cards detected between players")
    
    return human_cards, ai_cards

# Initialize session state
if 'human_cards' not in st.session_state:
    st.session_state.human_cards, st.session_state.ai_cards = deal_cards()
if 'table_cards' not in st.session_state:
    st.session_state.table_cards = []
if 'scores' not in st.session_state:
    st.session_state.scores = {'human': 0, 'ai': 0}

# Card display CSS
card_style = """
<style>
.card {
    width: 100px;
    height: 150px;
    border: 1px solid #000;
    border-radius: 10px;
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    margin: 5px;
    position: relative;
    background: linear-gradient(135deg, #f8f8f8, #ffffff);
    box-shadow: 2px 2px 5px rgba(0,0,0,0.3);
    font-family: 'Georgia', serif;
}
.card-value {
    font-size: 32px;
    font-weight: bold;
    text-align: center;
    color: #333333;
}
</style>
"""

def display_card(value):
    return f"""
    <div class="card">
        <div class="card-value">{value}</div>
    </div>
    """

def recognize_card(image):
    # Convert image to base64
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    # Save the image to a temp local path
    temp_image_path = "/tmp/temp_card_image.png"
    image.save(temp_image_path, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    invoker = VLMInvoker(st.session_state.vlm_model_id, st.session_state.vlm_model_tag)
    invoker.add_image(temp_image_path)
    # prompt = f"""你是一个人工智能扑克牌机器人，游戏开始时你和人类各有随机5张牌。
    # 游戏一共五局，每局都是人类先出，你之后出牌。
    # 每局的规则都是按扑克牌上的数字比大小决定输赢。最后按5局中谁赢的总数多获胜。
    # 请考虑必要的策略，使你赢的总局数大于人类。
    # 现在，人类出牌是图片中的牌数.
    # 你手上所有的牌是: {', '.join(CARD_VALUES)}，你需要选择出一张牌。
    # """
    prompt = f"""Identify the poker card in this image, respond with just the card value {', '.join(CARD_VALUES)}"""
    invoker.add_user_message(prompt)
    ret = invoker.invoke()
    print(ret)
    return ret

def ai_decision(human_card, ai_cards):
    # Prepare prompt for QwQ-32B
    prompt = f"""你是一个人工智能扑克牌机器人，游戏开始时你和人类各有随机5张牌。
    游戏一共五局，每局都是人类先出，你之后出牌。
    每局的规则都是按扑克牌上的数字比大小决定输赢。最后按5局中谁赢的总数多获胜。
    请考虑必要的策略，使你赢的总局数大于人类。
    现在，人类出牌是 {human_card}.
    你手上所有的牌是: {', '.join(ai_cards)}，你需要选择出一张牌。
    只需要返回 json 格式如下 {{"card": "A"}}."""
    
    print(prompt)
    # Create stream container with scrollbar
    st.markdown("""
    <style>
    .stream-container {
        height: 500px;
        overflow-y: auto;
        border: 1px solid #ddd;
        padding: 10px;
        border-radius: 5px;
        background-color: #f9f9f9;
    }
    </style>
    """, unsafe_allow_html=True)
    
    stream_container = st.container()
    with stream_container:
        stream_placeholder = st.empty()
    
    full_response = ""
    
    # Initialize invoker with user-selected model
    invoker = ConversationInvoker(st.session_state.llm_model_id, st.session_state.llm_model_tag)
    invoker.add_user_message(prompt)
    
    # Get the stream response
    stream_response = invoker.invoke(stream=True)
    
    # Process stream chunks
    for chunk in stream_response:
        if isinstance(chunk, dict) and 'choices' in chunk:
            delta = chunk['choices'][0]['delta']
            if 'content' in delta:
                token = delta['content']
                full_response += token
                # Update content with enhanced auto-scroll JavaScript
                stream_placeholder.markdown(f"""
                <div class="stream-container" id="stream-div">
                    <p>{full_response}</p>
                </div>
                """, unsafe_allow_html=True)
    
    try:
        # Find last JSON object in response
        json_start = full_response.rfind('{')
        json_end = full_response.rfind('}') + 1
        json_str = full_response[json_start:json_end]
        
        # Preprocess JSON string - convert single quotes to double
        json_str = json_str.replace("'", '"')
        print('Extracted JSON:', json_str)
        
        # Parse final response
        response_json = json.loads(json_str)
        chosen_card = response_json['card']
        
        # Validate card exists in AI's hand
        if chosen_card in ai_cards:
            return chosen_card
        else:
            st.warning(f"AI tried to play invalid card {chosen_card}")
            # Fallback to random valid card
            return random.choice(ai_cards)
            
    except (json.JSONDecodeError, KeyError) as e:
        st.error(f"Failed to parse AI response: {str(e)}")
        # Fallback to random card if parsing fails
        return random.choice(ai_cards)

st.markdown(card_style, unsafe_allow_html=True)

# Main container
with st.container():
    st.title("AI Poker Game")
    
    # Game status and controls
    with st.container():
        col1, col2 = st.columns([1, 1])
        with col1:
            
            # Webcam capture
            img_file_buffer = st.camera_input("Take a picture of your card")
            
            # Model selection controls
            st.subheader("Model Settings")
            
            # LLM Model radio buttons
            selected_llm = st.radio(
                "LLM Model",
                options=list(LLM_MODEL_OPTIONS.keys()),
                index=list(LLM_MODEL_OPTIONS.keys()).index(st.session_state.llm_model_id) 
                      if st.session_state.llm_model_id in LLM_MODEL_OPTIONS else 0
            )
            # Update session state with selected model and its corresponding tag
            st.session_state.llm_model_id = selected_llm
            st.session_state.llm_model_tag = LLM_MODEL_OPTIONS[selected_llm]
            
            # VLM Model radio buttons
            selected_vlm = st.radio(
                "VLM Model",
                options=list(VLM_MODEL_OPTIONS.keys()),
                index=list(VLM_MODEL_OPTIONS.keys()).index(st.session_state.vlm_model_id)
                      if st.session_state.vlm_model_id in VLM_MODEL_OPTIONS else 0
            )
            # Update session state with selected model and its corresponding tag
            st.session_state.vlm_model_id = selected_vlm
            st.session_state.vlm_model_tag = VLM_MODEL_OPTIONS[selected_vlm]

            if img_file_buffer is not None:
                # Recognize card
                image = Image.open(img_file_buffer)
                recognized_card = recognize_card(image)
                found = True
                # Update game state - remove played card
                if recognized_card in st.session_state.human_cards:
                    st.session_state.human_cards.remove(recognized_card)
                else:
                    st.warning(f"Card {recognized_card} not found in your hand!")
                    found = False
                
                if found:
                    # AI makes decision
                    ai_card = ai_decision(recognized_card, st.session_state.ai_cards)
                    st.session_state.ai_cards.remove(ai_card)
                    
                    # Determine round winner
                    human_value = CARD_VALUES.index(recognized_card)
                    ai_value = CARD_VALUES.index(ai_card)
                    
                    if human_value > ai_value:
                        st.session_state.scores['human'] += 1
                        st.success("You won this round!")
                    elif ai_value > human_value:
                        st.session_state.scores['ai'] += 1
                        st.error("AI won this round!")
                    else:
                        st.warning("It's a tie!")
                    
                    # Update table
                    st.session_state.table_cards.append((recognized_card, ai_card))
                    
                    # Check if game is over
                    if not st.session_state.human_cards and not st.session_state.ai_cards:
                        if st.session_state.scores['human'] > st.session_state.scores['ai']:
                            st.balloons()
                            st.success("🎉 You won the game! 🎉")
                        elif st.session_state.scores['ai'] > st.session_state.scores['human']:
                            st.error("🤖 AI won the game! 🤖")
                        else:
                            st.warning("🤝 It's a tie game! 🤝")

        with col2:
            # Scores
            score_col1, score_col2 = st.columns(2)
            with score_col1:
                st.metric("Your Score", st.session_state.scores['human'])
            with score_col2:
                st.metric("AI Score", st.session_state.scores['ai'])
            # Cards display
            st.subheader("Your Cards")
            st.markdown("".join([display_card(c) for c in st.session_state.human_cards]), unsafe_allow_html=True)
            
            st.subheader("AI Cards")
            st.markdown("".join([display_card(c) for c in st.session_state.ai_cards]), unsafe_allow_html=True)
            st.subheader("Table")
            st.markdown("".join([display_card(f"{h} vs {a}") for h,a in st.session_state.table_cards]), unsafe_allow_html=True)
