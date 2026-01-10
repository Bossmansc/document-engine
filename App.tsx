        
        try:
            report = json.loads(clean_json)
        except:
            report = {
                "summary": result_json_str,
                "keyPoints": [],
                "topics": []
            }
            
        return jsonify(report), 200

    except Exception as e:
        logger.error(f"Deep analysis error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    session_id = data.get('session_id')
    message = data.get('message')
    history_list = data.get('history', [])
    
    if not session_id or not message: return jsonify({"error": "Missing data"}), 400
    
    runtime = get_or_create_runtime(session_id)
    if not runtime: runtime = init_new_session(session_id)
    
    try:
        if not os.environ.get('OPENAI_API_KEY'): return jsonify({"response": "API Key missing"}), 200
        llm = ChatOpenAI(temperature=0.7, model_name="gpt-3.5-turbo")
        
        history_context = [msg for msg in history_list if msg.get('content') != message]
        history_str = format_history_from_list(history_context)
        
        standalone_question = message
        if history_context:
            condense_chain = LLMChain(llm=llm, prompt=CONDENSE_PROMPT)
            standalone_question = condense_chain.run(chat_history=history_str, question=message)
        
        context_text = "No docs found."
        sources = []
        if runtime['vectorstore']:
            docs = runtime['vectorstore'].similarity_search(standalone_question, k=4)
            if docs:
                context_text = "\n\n".join([d.page_content for d in docs])
                for d in docs[:3]:
                    sources.append(" ".join(d.page_content[:150].split()) + "...")
        
        answer_chain = LLMChain(llm=llm, prompt=ANSWER_PROMPT)
        response = answer_chain.run(context=context_text, chat_history=history_str, question=message)
        
        if session_id not in persistent_store: persistent_store[session_id] = {'chunks': [], 'history': [], 'file_texts': {}}
        persistent_store[session_id]['history'].append(('user', message))
        persistent_store[session_id]['history'].append(('assistant', response))
        save_persistence()
        
        return jsonify({"response": response, "sources": sources}), 200
    except Exception as e:
        logger.error(f"Chat error: {e}")
        return jsonify({"response": f"Error: {e}", "sources": []}), 500

@app.route('/clear_memory/<session_id>', methods=['POST'])
def clear_memory(session_id):
    if session_id in persistent_store:
        persistent_store[session_id]['history'] = []
        save_persistence()
    return jsonify({"message": "Cleared"}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
