import React, { Component, PropTypes } from 'react'
import {
  Button,
  Card,
} from 'semantic-ui-react'
import marked from 'marked'

class View extends Component {
  static propTypes = {
    match: PropTypes.shape({
      params: PropTypes.shape({
        id: PropTypes.string.isRequired,
      }).isRequired,
    }).isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      data: {
        list: 'Loading...',
      },
    }
  }

  componentDidMount() {
    fetch(`/api/v1/list/${this.props.match.params.id}`)
      .then(response => response.json())
      .then(data => data.body)
      .then(data => this.setState({ data }))
  }

  render() {
    marked.setOptions({
      gfm: true,
      tables: true,
      breaks: true,
      pedantic: false,
      sanitize: true,
      smartLists: true,
      smartypants: false,
    })

    return (
      <div style={{ padding: '10px' }}>
        <Card id={`list_${this.props.match.params.id}`} fluid>
          <Card.Content>
            <div dangerouslySetInnerHTML={{ __html: marked(this.state.data.list) }} />
          </Card.Content>
          <Card.Content extra>
            {[
              { content: 'Edit', url: 'edit', color: 'green', icon: 'edit' },
              { content: 'Share', url: 'share', color: 'yellow', icon: 'send' },
            ].map(e =>
              <Button
                {...e}
                size="tiny"
                href={`/#/${e.url}/${this.props.match.params.id}`}
              />
            )}
          </Card.Content>
        </Card>
      </div>
    )
  }
}

export default View
